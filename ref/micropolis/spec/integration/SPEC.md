# Platform Integration (Sugar, Networking)

## Scope
This spec covers the platform glue around the core Micropolis executable:
- Sugar (OLPC) activity wrapper and its process, audio, and presence hooks.
- TTY stdin command channel used by external controllers.
- Optional UDP networking hooks compiled under NET.

It does not restate UI or sim internals beyond what the integration layer calls.

## Browser bridge ordering/recovery contracts (Stage 4 shipping path)
Micropolis C integration does not define a wire-level `serverSeq` cursor. For browser
shipping, the bridge layer adds an explicit sequencing contract while preserving C's
forward-only simulation intent (`CityTime` in `src/sim/s_sim.c`, frame progression in
`src/sim/sim.c`).

### Sequencing fields
- Every sequenced authoritative envelope carries both `serverSeq` and `tick`.
- `serverSeq` is strictly monotonic and gap-free in the normal apply path.
- `tick` is monotonic non-decreasing for applied envelopes.

### Client/runtime apply rules
1. Drop stale envelopes when `serverSeq <= lastAppliedServerSeq`.
2. Enter recovery and request snapshot when `serverSeq > expectedServerSeq`
   (`expectedServerSeq = lastAppliedServerSeq + 1`).
3. Enter recovery and request snapshot on tick regression
   (`tick < lastAppliedTick`) even when `serverSeq` is in order.
4. During recovery, preserve last committed authoritative state and clear
   client-only pending tool visuals.

### Snapshot recovery rules
- Recovery requests carry `fromServerSeq` as the first missing sequence.
- Snapshot envelopes establish a new authoritative baseline (`serverSeq`/base seq + tick).
- Ordered tail envelopes replay after snapshot to rebuild current state deterministically.

## Sugar Activity Wrapper (Python)
### Activity metadata (activity/activity.info)
- INI-style file with a single [Activity] section:
  - name = Micropolis
  - activity_version = 7
  - icon = activity-micropolis
  - service_name = org.laptop.Micropolis
  - class = micropolisactivity.MicropolisActivity
  - show_launcher = yes
- The icon resolves to activity/activity-micropolis.svg.

### Data model
MicropolisActivity instance fields used by the integration layer:
- _bundle_path: bundle root path from sugar.activity.activity.get_bundle_path().
- _process: subprocess.Popen instance for the Micropolis binary.
- _stdout_thread: thread id (from thread.start_new) or None.

### Startup flow (MicropolisActivity.__init__)
1. Call activity.Activity.__init__.
2. Set activity title to "Micropolis Activity" (gettext translated).
3. Connect GTK signals:
   - destroy -> _destroy_cb
   - focus-in-event -> _focus_in_cb
   - focus-out-event -> _focus_out_cb
4. Install SIGCHLD handler -> _sigchild_handler.
5. Compute _bundle_path via get_bundle_path().
6. Launch child process:
   - executable: <bundle_path>/Micropolis
   - args: [<bundle_path>/Micropolis, "-t"]
   - stdin/stdout: subprocess.PIPE
   - close_fds: True
   - cwd: _bundle_path
   - preexec_fn: chdir(_bundle_path)
7. Start stdout reader thread calling _stdout_thread_function.
8. Send initial Tcl commands to the child stdin:
   - SugarStartUp "<uri>" where uri = handle.uri or empty string.
   - SugarNickName "<nick>" where nick = profile.get_nick_name() or empty string.
9. Initialize presence service:
   - ps = presenceservice.get_instance().
   - For each buddy in ps.get_buddies(), call _buddy_appeared_cb(ps, buddy).
   - Connect callbacks: "buddy-appeared" and "buddy-disappeared".

Notes:
- There is a disabled GtkSocket embed block (wrapped in if False) that does not run.
- No stderr pipe is attached; child stderr goes to parent stderr.

### Tcl command transport
- QuoteTCL(s): returns s with all double quotes replaced by \". It does not escape backslashes or braces.
- send_process(message): writes the message to child stdin; no explicit flush is performed.
- All Sugar commands include a trailing "\n" when sent.

### Stdout protocol from child
_stdout_thread_function reads child stdout and reacts to specific lines:
- Sets FD_CLOEXEC on stdout to 0 via fcntl(F_SETFD, 0).
- Loops readline() on process stdout. On exception, breaks.
- Strips the line. Empty lines are skipped.
- Splits using line.strip().split(' ') (explicit space delimiter).
- If first token is "PlaySound", calls play_sound(words[1]).
- All other commands are ignored.

Edge cases:
- "PlaySound" lines with no second token raise IndexError and terminate the thread.
- Multiple spaces in a line produce empty tokens due to split(' '), which can make words[1] empty.

### Audio playback (pygame.mixer)
- At import time, pygame.mixer.init() is attempted; failures are ignored.
- play_sound(name):
  - file path: <bundle_path>/res/sounds/<name.lower()>.wav
  - prints "PLAY_SOUND <path>" to stdout.
  - tries pygame.mixer.Sound(path) and sound.play().
  - on exception, prints "Can't play sound: <path> <error>" and continues.

### Activity events -> Tcl commands
- share(): calls Activity.share(self) then sends "SugarShare\n".
- quit_process(): sends "SugarQuit\n" then sleeps 10 seconds.
- _destroy_cb(): calls quit_process().
- _focus_in_cb(): sends "SugarActivate\n".
- _focus_out_cb(): sends "SugarDeactivate\n".

### Buddy presence bridging
For buddy events, collect fields in this order (fallback to legacy getters on AttributeError):
- key: buddy.props.key or buddy.get_name()
- nick: buddy.props.nick or buddy.get_name()
- color: buddy.props.color or buddy.get_color()
- address: buddy.props.ip4_address or buddy.get_ip4_address()

Then send:
- buddy appeared: SugarBuddyAdd "<key>" "<nick>" "<color>" "<address>"\n
- buddy disappeared: SugarBuddyDel "<key>" "<nick>" "<color>" "<address>"\n

### Signal handling
- _sigchild_handler(signum, frame): logs and immediately calls sys.exit(0).

### Tcl side expectations
The Sugar wrapper emits Tcl commands that are not defined in this repo:
- SugarStartUp, SugarNickName, SugarShare, SugarQuit, SugarActivate, SugarDeactivate,
  SugarBuddyAdd, SugarBuddyDel.
A reimplementation must accept these commands (even as no-ops) if stdin command
processing is enabled to avoid Tcl errors.

## TTY stdin command channel
TTY mode is part of platform integration because external controllers (including
Sugar) use stdin to send Tcl commands.

### Command-line flags (sim.c)
- -t: sets sim_tty = isatty(0) (1 if stdin is a TTY, else 0).
- -S: sets SugarMode = 1.
- -m: sets MultiPlayerMode = 1.
- -d <display>: appends display and implicitly sets MultiPlayerMode when multiple
  displays are provided.

### StdinProc behavior (w_tk.c)
- A Tcl command buffer is created: buffer = Tcl_CreateCmdBuf().
- If sim_tty != 0, stdin file handler is installed:
  Tk_CreateFileHandler(0, TK_READABLE, StdinProc, 0).
- StdinProc reads stdin with fgets(line, 200, stdin).
  - If EOF and no partial command:
    - if sim_tty: sim_exit(0) (sets tkMustExit and ExitReturn).
    - else: Tk_DeleteFileHandler(0).
  - If EOF but a partial command exists, treat line as empty and continue.
- Tcl_AssembleCmd(buffer, line) is used to handle continuation lines.
- Completed command is evaluated via Tcl_RecordAndEval(tk_mainInterp, cmd, 0).
- If interp->result is non-empty:
  - printed to stdout if result != TCL_OK OR sim_tty != 0.
- If sim_tty != 0, prints prompt "sim:\n" and flushes stdout after each command.
- After UIStartMicropolis is evaluated, if sim_tty != 0, prints initial prompt
  "sim:\n" and flushes stdout.

Note: when Micropolis is launched with stdin as a pipe (not a real TTY), -t still
sets sim_tty to 0 because isatty(0) is false. In that configuration, stdin is not
registered with Tk and commands sent to stdin are not processed by this handler.

## UDP networking hooks (NET)
These functions only exist when compiled with NET.

### Globals and constants
- NET_BUFFER_SIZE = 1024.
- net_listen_port (int)
- net_listen_socket (int)

### Tcl commands (w_sim.c)
- sim ListenTo <port>
  - Parses <port> as int.
  - Calls udp_listen(port) and returns the socket integer in interp->result.
- sim HearFrom file<sock>
  - Expects argv[2] to start with "file" followed by the integer socket.
  - Calls udp_hear(sock). No result is returned.

### udp_listen(port) (w_net.c)
- Creates a UDP socket: socket(AF_INET, SOCK_DGRAM, 0).
- Sets SO_REUSEADDR to 1 via setsockopt.
- Binds to INADDR_ANY with:
  - addr.sin_family = AF_INET
  - addr.sin_port = net_listen_port (no htons conversion)
  - addr.sin_addr.s_addr = INADDR_ANY
- Sets non-blocking mode by fcntl(F_GETFL) then fcntl(F_SETFL, flags | O_NDELAY).
- Registers the fd with Tcl: Tcp_MakeOpenFile(tk_mainInterp, net_listen_socket, 1, 1).
- Returns net_listen_socket on success; returns 0 on failure (after perror()).

### udp_hear(sock) (w_net.c)
- Reads packets in a loop using recvfrom(sock, buf, NET_BUFFER_SIZE, 0, &addr, &addr_len).
- Error handling:
  - EINTR: continue loop.
  - EWOULDBLOCK: break loop (no more data).
  - other errors: perror("recvfrom") and return.
- For each received packet (len bytes):
  - Build Tcl command string:
    HandlePacket <sock> {<ip>} {<byte0> <byte1> ...}
  - <ip> is inet_ntoa(addr.sin_addr) (no port).
  - Each byte is formatted as "%3d " (width 3 plus trailing space).
  - Command is executed via Eval(cmd).

Edge cases:
- addr_len is not initialized before recvfrom, which is undefined behavior in C.
  A robust reimplementation should pass sizeof(addr) while preserving output format.

## Source map
- micropolisactivity.py
- activity/activity.info
- src/sim/sim.c
- src/sim/w_tk.c
- src/sim/w_sim.c
- src/sim/w_net.c
- src/sim/headers/sim.h
- res/sounds (runtime sound files used by the Sugar wrapper)
