/**
 * Bundled copy of canonical `stri.301` message text lines.
 * Mirrors `GetIndString(..., 301, MesNum)` resource payload usage in
 * `ref/micropolis/src/sim/s_msg.c`.
 * Parity notes: this is a 1:1 textual copy of `ref/micropolis/res/stri.301`
 * embedded in TypeScript so runtime consumers do not need filesystem access.
 */
export const MICROPOLIS_STRI_301_LINES = [
  'More residential zones needed.',
  'More commercial zones needed.',
  'More industrial zones needed.',
  'More roads required.',
  'Inadequate rail system.',
  'Build a Power Plant.',
  'Residents demand a Stadium.',
  'Industry requires a Sea Port.',
  'Commerce requires an Airport.',
  'Pollution very high.',
  'Crime very high.',
  'Frequent traffic jams reported.',
  'Citizens demand a Fire Department.',
  'Citizens demand a Police Department.',
  'Blackouts reported. Check power map.',
  'Citizens upset. The tax rate is too high.',
  'Roads deteriorating, due to lack of funds.',
  'Fire departments need funding.',
  'Police departments need funding.',
  'Fire reported !',
  'A Monster has been sighted !!',
  'Tornado reported !!',
  'Major earthquake reported !!!',
  'A plane has crashed !',
  'Shipwreck reported !',
  'A train crashed !',
  'A helicopter crashed !',
  'Unemployment rate is high.',
  'YOUR CITY HAS GONE BROKE!',
  'Firebombing reported !',
  'Need more parks.',
  'Explosion detected !',
  'Insufficient funds to build that.',
  'Area must be bulldozed first.',
  'Population has reached 2,000.',
  'Population has reached 10,000.',
  'Population has reached 50,000.',
  'Population has reached 100,000.',
  'Population has reached 500,000.',
  'Brownouts, build another Power Plant.',
  'Heavy Traffic reported.',
  'Flooding reported !!',
  'A Nuclear Meltdown has occurred !!!',
  "They're rioting in the streets !!",
  'End of Demo !!',
  'No Sound Server!',
  'No Multi Player License !!',
  'Started a New City.',
  'Restored a Saved City.',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
  'x',
] as const;

/**
 * One Tcl notice-table entry from `Messages($id)` in Micropolis UI scripts.
 * Mirrors `Message <id> <color> <title> <body>` declarations in
 * `ref/micropolis/res/micropolis.tcl`.
 * Parity note: Tcl `props` metadata (bitmaps/views) is intentionally excluded;
 * this table only carries text/color content used by the web notice surface.
 */
export interface MicropolisNoticeTemplate {
  id: number;
  color: string;
  title: string;
  bodyTemplate: string;
}

/**
 * Bundled copy of canonical Micropolis notice-table entries.
 * Mirrors `Message` declarations consumed by `UIShowPictureOn` in
 * `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this is a textual/data port for runtime lookup and does not
 * execute Tcl `format`, `props`, or `view` scripts.
 */
export const MICROPOLIS_NOTICE_TEMPLATES = [
  {
    id: 1,
    color: '#7f7fff',
    title: 'DULLSVILLE, USA  1900',
    bodyTemplate:
      "Things haven't changed much around here in the last hundred years or so and the residents are beginning to get bored.  They think Dullsville could be the next great city with the right leader.\n\nIt is your job to attract new growth and development, turning Dullsville into a Metropolis within 30 years.",
  },
  {
    id: 2,
    color: '#7f7fff',
    title: 'SAN FRANCISCO, CA.  1906',
    bodyTemplate:
      'Damage from the earthquake was minor compared to that of the ensuing fires, which took days to control.  1500 people died.\n\nControlling the fires should be your initial concern.  Then clear the rubble and start rebuilding.  You have 5 years.',
  },
  {
    id: 3,
    color: '#7f7fff',
    title: 'HAMBURG, GERMANY  1944',
    bodyTemplate:
      'Allied fire-bombing of German cities in WWII caused tremendous damage and loss of life.  People living in the inner cities were at greatest risk.\n\nYou must control the firestorms during the bombing and then rebuild the city after the war.  You have 5 years.',
  },
  {
    id: 4,
    color: '#7f7fff',
    title: 'BERN, SWITZERLAND  1965',
    bodyTemplate:
      'The roads here are becoming more congested every day, and the residents are upset.  They demand that you do something about it.\n\nSome have suggested a mass transit system as the answer, but this would require major rezoning in the downtown area.  You have 10 years.',
  },
  {
    id: 5,
    color: '#7f7fff',
    title: 'TOKYO, JAPAN  1957',
    bodyTemplate:
      'A large reptilian creature has been spotted heading for Tokyo bay.  It seems to be attracted to the heavy levels of industrial pollution there.\n\nTry to control the fires, then rebuild the industrial center.  You have 5 years.',
  },
  {
    id: 6,
    color: '#7f7fff',
    title: 'DETROIT, MI.  1972',
    bodyTemplate:
      'By 1970, competition from overseas and other economic factors pushed the once "automobile capital of the world" into recession.  Plummeting land values and unemployment then increased crime in the inner-city to chronic levels.\n\nYou have 10 years to reduce crime and rebuild the industrial base of the city.',
  },
  {
    id: 7,
    color: '#7f7fff',
    title: 'BOSTON, MA.  2010',
    bodyTemplate:
      'A major meltdown is about to occur at one of the new downtown nuclear reactors.  The area in the vicinity of the reactor will be severly contaminated by radiation, forcing you to restructure the city around it.\n\nYou have 5 years to get the situation under control.',
  },
  {
    id: 8,
    color: '#7f7fff',
    title: 'RIO DE JANEIRO, BRAZIL  2047',
    bodyTemplate:
      'In the mid-21st century, the greenhouse effect raised global temperatures 6 degrees F.  Polar icecaps melted and raised sea levels worldwide.  Coastal areas were devastated by flood and erosion.\n\nYou have 10 years to turn this swamp back into a city again.',
  },
  {
    id: 9,
    color: '#ffa500',
    title: 'Query Zone Status',
    bodyTemplate:
      'Zone:\t    %s\nDensity:    %s\nValue:\t    %s\nCrime:\t    %s\nPollution:  %s\nGrowth:\t    %s',
  },
  {
    id: 10,
    color: '#ff4f4f',
    title: 'POLLUTION ALERT!',
    bodyTemplate:
      'Pollution in your city has exceeded the maximum allowable amounts established by the Micropolis Pollution Agency.  You are running the risk of grave ecological consequences.\n\nEither clean up your act or open a gas mask concession at city hall.',
  },
  {
    id: 11,
    color: '#ff4f4f',
    title: 'CRIME ALERT!',
    bodyTemplate:
      'Crime in your city is our of hand.  Angry mobs are looting and vandalizing the central city.  The president will send in the national guard soon if you cannot control the problem.',
  },
  {
    id: 12,
    color: '#ff4f4f',
    title: 'TRAFFIC WARNING!',
    bodyTemplate:
      'Traffic in this city is horrible.  The city gridlock is expanding.  The commuters are getting militant.\n\nEither build more roads and rails or get a bulletproof limo.',
  },
  {
    id: 20,
    color: '#ff4f4f',
    title: 'FIRE REPORTED!',
    bodyTemplate: 'A fire has been reported!',
  },
  {
    id: 21,
    color: '#ff4f4f',
    title: 'MONSTER ATTACK!',
    bodyTemplate:
      'A large reptilian creature has been spotted in the water.  It seems to be attracted to areas of high pollution.  There is a trail of destruction wherever it goes.  All you can do is wait till he leaves, then rebuild from the rubble.',
  },
  {
    id: 22,
    color: '#ff4f4f',
    title: 'TORNADO ALERT!',
    bodyTemplate:
      "A tornado has been reported!  There's nothing you can do to stop it, so you'd better prepare to clean up after the disaster!",
  },
  {
    id: 23,
    color: '#ff4f4f',
    title: 'EARTHQUAKE!',
    bodyTemplate:
      'A major earthquake has occurred!  Put out the fires as quickly as possible, before they spread, then reconnect the power grid and rebuild the city.',
  },
  {
    id: 24,
    color: '#ff4f4f',
    title: 'PLANE CRASH!',
    bodyTemplate: 'A plane has crashed!',
  },
  {
    id: 25,
    color: '#ff4f4f',
    title: 'SHIPWRECK!',
    bodyTemplate: 'A ship has wrecked!',
  },
  {
    id: 26,
    color: '#ff4f4f',
    title: 'TRAIN CRASH!',
    bodyTemplate: 'A train has crashed!',
  },
  {
    id: 27,
    color: '#ff4f4f',
    title: 'HELICOPTER CRASH!',
    bodyTemplate: 'A helicopter has crashed!',
  },
  {
    id: 30,
    color: '#ff4f4f',
    title: 'FIREBOMBING REPORTED!',
    bodyTemplate: 'Firebombs are falling!!',
  },
  {
    id: 35,
    color: '#7fff7f',
    title: 'TOWN',
    bodyTemplate:
      'Congratulations, your village has grown to town status.  You now have 2,000 citizens.',
  },
  {
    id: 36,
    color: '#7fff7f',
    title: 'CITY',
    bodyTemplate:
      'Your town has grown into a full sized city, with a current population of 10,000.  Keep up the good work!',
  },
  {
    id: 37,
    color: '#7fff7f',
    title: 'CAPITAL',
    bodyTemplate:
      'Your city has become a capital.  The current population here is 50,000.  Your political future looks bright.',
  },
  {
    id: 38,
    color: '#7fff7f',
    title: 'METROPOLIS',
    bodyTemplate:
      'Your capital city has now achieved the status of metropolis.  The current population is 100,000.  With your management skills, you should seriously consider running for governor.',
  },
  {
    id: 39,
    color: '#7fff7f',
    title: 'MEGALOPOLIS',
    bodyTemplate:
      'Congratulation, you have reached the highest category of urban development, the megalopolis.\n\nIf you manage to reach this level, send us email at micropolis@laptop.org or send us a copy of your city.  We might do something interesting with it.',
  },
  {
    id: 40,
    color: '#7fff7f',
    title: 'MEGALINIUM',
    bodyTemplate:
      'Congratulation, you have reached the end of time!\n\nBecause of the toroidal nature of the the Micropolis Space/Time Continuum, your city has wrapped back in time to 1900!',
  },
  {
    id: 41,
    color: '#ff4f4f',
    title: 'HEAVY TRAFFIC!',
    bodyTemplate: 'Sky Watch One\nreporting heavy traffic!',
  },
  {
    id: 42,
    color: '#ff4f4f',
    title: 'FLOODING REPORTED!',
    bodyTemplate: "Flooding has been been reported along the water's edge!",
  },
  {
    id: 43,
    color: '#ff4f4f',
    title: 'NUCLEAR MELTDOWN!',
    bodyTemplate:
      'A nuclear meltdown has occured at your power plant.  You are advised to avoid the area until the radioactive isotopes decay.\n\nMany generations will confront this problem before it goes away, so do not hold your breath.',
  },
  {
    id: 44,
    color: '#ff4f4f',
    title: 'RIOTS!',
    bodyTemplate:
      'The citizens are rioting in the streets, setting cars and houses on fire, and bombing government buildings and businesses!\n\nAll media coverage is blacked out, while the fascist pigs beat the poor citizens into submission.',
  },
  {
    id: 46,
    color: '#ff4f4f',
    title: 'NO SOUND SERVER!',
    bodyTemplate:
      'There is no sound server running on your X11 display "%s".  You will not hear any noise unless you run a sound server, and turn the sound back on in the "Options" menu.',
  },
  {
    id: 48,
    color: '#7f7fff',
    title: 'Start a New City',
    bodyTemplate:
      'Build your very own city from the ground up, starting with this map of uninhabited land.',
  },
  {
    id: 49,
    color: '#7f7fff',
    title: 'Restore a Saved City',
    bodyTemplate: 'This city was saved in the file named: %s',
  },
  {
    id: 100,
    color: '#7fff7f',
    title: "YOU'RE A WINNER!",
    bodyTemplate:
      'Your mayorial skill and city planning expertise have earned you the KEY TO THE CITY.  Local residents will erect monuments to your glory and name their first-born children after you.  Why not run for governor?',
  },
  {
    id: 200,
    color: '#ff4f4f',
    title: 'IMPEACHMENT NOTICE!',
    bodyTemplate:
      'The entire population of this city has finally had enough of your inept planning and incompetant management.  An angry mob -- led by your mother -- has been spotted in the vicinity of city hall.\n\nYou should seriously consider taking an extended vacation -- NOW.  (Or read the manual and try again.)',
  },
  {
    id: 300,
    color: '#ffd700',
    title: 'About Micropolis',
    bodyTemplate:
      'Micropolis Version [sim Version] Copyright (C) 2007\n    by Electronic Arts.\nBased on the Original Micropolis Concept and Design\n    by Will Wright.\nTCL/Tk User Interface Designed and Created\n    by Don Hopkins, DUX Software.\nPorted to Linux, Optimized and Adapted for OLPC\n    by Don Hopkins.\nLicensed under the GNU General Public License,\n    version 3, with additional conditions.',
  },
] as const satisfies readonly MicropolisNoticeTemplate[];

const MICROPOLIS_NOTICE_TEMPLATE_BY_ID = new Map<number, MicropolisNoticeTemplate>(
  MICROPOLIS_NOTICE_TEMPLATES.map((entry) => [entry.id, entry]),
);

/**
 * One formatted notice message resolved for presentation.
 * Mirrors the title/body tuple consumed by `NoticeMessageOn` in
 * `ref/micropolis/res/micropolis.tcl`.
 */
export interface MicropolisNoticeMessage {
  id: number;
  color: string;
  title: string;
  body: string;
}

/**
 * Lookup helper for `stri.301` message ids.
 * Mirrors 1-based `GetIndString(..., 301, num)` indexing in
 * `ref/micropolis/src/sim/w_resrc.c` used by `ref/micropolis/src/sim/s_msg.c`.
 * Parity notes: C writes into a caller buffer; this TypeScript port returns
 * `undefined` when the id is out of range.
 */
export function lookupStri301MessageText(id: number): string | undefined {
  if (!Number.isFinite(id)) {
    return undefined;
  }

  const oneBasedId = Math.trunc(id);
  if (oneBasedId < 1 || oneBasedId > MICROPOLIS_STRI_301_LINES.length) {
    return undefined;
  }

  return MICROPOLIS_STRI_301_LINES[oneBasedId - 1];
}

/**
 * Lookup helper for `doMessage` ids, including negative picture ids.
 * Mirrors `pictId = -MesNum; MessagePort = pictId` flow in
 * `ref/micropolis/src/sim/s_msg.c`, where picture ids are followed by the same
 * positive text id on the next message cycle.
 */
export function lookupDoMessageText(id: number): string | undefined {
  if (!Number.isFinite(id)) {
    return undefined;
  }

  const truncatedId = Math.trunc(id);
  const textId = truncatedId < 0 ? -truncatedId : truncatedId;
  return lookupStri301MessageText(textId);
}

/**
 * Lookup helper for Tcl `Messages($id)` notice templates.
 * Mirrors `set msg $Messages($id)` lookup in `UIShowPictureOn` from
 * `ref/micropolis/res/micropolis.tcl`.
 */
export function lookupMicropolisNoticeTemplate(id: number): MicropolisNoticeTemplate | undefined {
  if (!Number.isFinite(id)) {
    return undefined;
  }

  return MICROPOLIS_NOTICE_TEMPLATE_BY_ID.get(Math.trunc(id));
}

/**
 * Formats one notice body using Tcl-like `%s` replacement semantics.
 * Mirrors `format {$body} $parms` in `UIShowPictureOn` from
 * `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this helper intentionally handles `%s` substitutions only.
 */
export function formatMicropolisNoticeBody(
  bodyTemplate: string,
  parameters: readonly (string | number)[] = [],
): string {
  let parameterIndex = 0;
  return bodyTemplate.replace(/%s/g, () => {
    const replacement = parameters[parameterIndex];
    parameterIndex += 1;
    return replacement === undefined ? '%s' : String(replacement);
  });
}

/**
 * Resolves one full notice message from Tcl `Message` table data.
 * Mirrors `Messages($id)` lookup plus optional `format` interpolation in
 * `UIShowPictureOn` from `ref/micropolis/res/micropolis.tcl`.
 */
export function lookupMicropolisNoticeMessage(
  id: number,
  parameters?: readonly (string | number)[],
): MicropolisNoticeMessage | undefined {
  const template = lookupMicropolisNoticeTemplate(id);
  if (template === undefined) {
    return undefined;
  }

  return {
    id: template.id,
    color: template.color,
    title: template.title,
    body: formatMicropolisNoticeBody(template.bodyTemplate, parameters),
  };
}
