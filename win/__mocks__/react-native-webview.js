// Jest has no WebView2: the camera workout screen renders a plain view in tests.
const React = require('react');
const { View } = require('react-native');

const WebView = React.forwardRef((props, ref) => {
  React.useImperativeHandle(ref, () => ({ postMessage: () => {}, reload: () => {} }));
  return React.createElement(View, { testID: 'webview' });
});

module.exports = { WebView, default: WebView };
