import { describe, expect, test } from 'vitest';

import {
  openFloatingWindowInState,
  raiseFloatingWindowToFront,
  type RuntimeFloatingWindowsState,
} from './runtime-panel-controller.ts';

describe('runtime floating window stacking', () => {
  test('opens a window and raises it above currently open siblings', () => {
    const initialWindows: RuntimeFloatingWindowsState = {
      budget: { open: false, x: 140, y: 76, zIndex: 20 },
      evaluation: { open: true, x: 190, y: 116, zIndex: 21 },
      graph: { open: true, x: 240, y: 156, zIndex: 22 },
    };

    const openedBudget = openFloatingWindowInState(initialWindows, 'budget');

    expect(openedBudget.budget.open).toBe(true);
    expect(openedBudget.budget.zIndex).toBe(23);
    expect(openedBudget.evaluation.zIndex).toBe(21);
    expect(openedBudget.graph.zIndex).toBe(22);
  });

  test('keeps last opened window on top across sequential opens', () => {
    const initialWindows: RuntimeFloatingWindowsState = {
      budget: { open: false, x: 140, y: 76, zIndex: 20 },
      evaluation: { open: false, x: 190, y: 116, zIndex: 21 },
      graph: { open: false, x: 240, y: 156, zIndex: 22 },
    };

    const openedBudget = openFloatingWindowInState(initialWindows, 'budget');
    const openedGraph = openFloatingWindowInState(openedBudget, 'graph');
    const openedEvaluation = openFloatingWindowInState(openedGraph, 'evaluation');

    expect(openedBudget.budget.zIndex).toBe(23);
    expect(openedGraph.graph.zIndex).toBe(24);
    expect(openedEvaluation.evaluation.zIndex).toBe(25);
  });

  test('raises an interacted window above the current front window', () => {
    const initialWindows: RuntimeFloatingWindowsState = {
      budget: { open: true, x: 140, y: 76, zIndex: 23 },
      evaluation: { open: true, x: 190, y: 116, zIndex: 25 },
      graph: { open: true, x: 240, y: 156, zIndex: 24 },
    };

    const focusedBudget = raiseFloatingWindowToFront(initialWindows, 'budget');

    expect(focusedBudget.budget.zIndex).toBe(26);
    expect(focusedBudget.evaluation.zIndex).toBe(25);
    expect(focusedBudget.graph.zIndex).toBe(24);
  });

  test('returns the same state when focusing an already topmost window', () => {
    const initialWindows: RuntimeFloatingWindowsState = {
      budget: { open: true, x: 140, y: 76, zIndex: 20 },
      evaluation: { open: true, x: 190, y: 116, zIndex: 22 },
      graph: { open: true, x: 240, y: 156, zIndex: 21 },
    };

    const focusedEvaluation = raiseFloatingWindowToFront(initialWindows, 'evaluation');

    expect(focusedEvaluation).toBe(initialWindows);
  });
});
