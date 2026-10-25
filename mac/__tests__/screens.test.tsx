/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, {
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';

import App from '../src/App';

// Walks every sidebar section and pushed page, so a crash on any screen fails the test.

function allText(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map(t => [t.props.children].flat(Infinity).join(''))
    .join('\n');
}

async function press(renderer: Renderer, label: string) {
  const target = renderer.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0];
  if (!target) {
    throw new Error(`Nothing to press labelled "${label}"`);
  }
  await ReactTestRenderer.act(() => target.props.onPress());
}

async function pressFirst(renderer: Renderer, labelPart: string) {
  const target = renderer.root.findAll(
    n =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.includes(labelPart) &&
      typeof n.props.onPress === 'function',
  )[0];
  await ReactTestRenderer.act(() => target.props.onPress());
}

test('every section and page renders', async () => {
  let renderer!: Renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  const text = () => allText(renderer.root);

  expect(text()).toMatch(/Good (morning|afternoon|evening)/);
  expect(text()).toContain('How are you today?');
  expect(text()).toContain('Chickpea and spinach curry');

  // Marking an item done updates the count in the header.
  expect(text()).toContain('2 of 3 planned items left today.');
  await press(renderer, 'Mark Full body at home done');
  expect(text()).toContain('1 of 3 planned items left today.');

  // Check-in: rate energy and mood, then save.
  await press(renderer, 'Energy 4 of 5');
  await press(renderer, 'Mood 5 of 5');
  await press(renderer, 'Save check-in');
  expect(text()).toContain('Energy 4/5 · Mood 5/5');

  await press(renderer, 'Week');
  expect(text()).toContain('· Today');

  await press(renderer, 'Coach');
  expect(text()).toContain('What should I cook tonight? Something quick.');
  expect(text()).toContain('Memory checked');

  await press(renderer, 'Calendar');
  expect(text()).toContain('Your days, in rhythm.');
  expect(text()).toContain('Greek yogurt & berries');
  expect(text()).toContain('Full body at home'); // marking the plan done added a timed entry
  await press(renderer, 'Edit Greek yogurt & berries');
  expect(text()).toContain('Edit a moment');
  await press(renderer, 'Save on this Mac');
  await press(renderer, 'Recipe library ↗');
  expect(text()).toContain('YOUR RECIPES');
  await pressFirst(renderer, 'Chickpea and spinach curry');
  expect(text()).toContain('INGREDIENTS');
  await press(renderer, 'Increase Servings');
  expect(text()).toContain('1000 g'); // 800 g of chickpeas scaled from 4 to 5 servings
  await press(renderer, 'Add to shopping list');
  expect(text()).toContain('to your shopping list');
  await press(renderer, 'Back to Recipes');
  await pressFirst(renderer, 'Shopping list');
  expect(text()).toContain('TO BUY');

  await press(renderer, 'Calendar');
  await press(renderer, 'Workout library ↗');
  await pressFirst(renderer, 'Full body at home');
  expect(text()).toContain('EXERCISES');
  expect(text()).toContain('Last done yesterday · 28 min');
  await press(renderer, 'Back to Workouts');
  await pressFirst(renderer, '· 32:00 ·'); // the session, not the routine
  expect(text()).toContain('Set 1');

  await press(renderer, 'Profile');
  expect(text()).toContain('Day streak');
  expect(text()).toContain('ABOUT YOU');
  await pressFirst(renderer, 'What BuildNorth remembers');
  expect(text()).toContain('I prefer vegetarian dinners on weekdays.');
});
