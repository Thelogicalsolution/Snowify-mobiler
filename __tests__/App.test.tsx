/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@rntp/player', () => ({
  __esModule: true,
  default: {
    pause: jest.fn(),
    play: jest.fn(),
    setMediaItems: jest.fn(),
    setupPlayer: jest.fn(),
  },
  useIsPlaying: () => false,
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
