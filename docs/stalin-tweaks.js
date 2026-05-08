// SOVIET CODE — Tweaks panel
// Loaded after react/react-dom/babel and tweaks-panel.jsx.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "humor": "maximalist"
} /*EDITMODE-END*/;
function SovietTweaks() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  React.useEffect(() => {
    document.body.dataset.humor = t.humor;
  }, [t.humor]);
  return /*#__PURE__*/React.createElement(TweaksPanel, {
    title: "Tweaks"
  }, /*#__PURE__*/React.createElement(TweakSection, {
    title: "Humor dial"
  }, /*#__PURE__*/React.createElement(TweakRadio, {
    label: "Aesthetic",
    value: t.humor,
    options: [{
      value: 'deadpan',
      label: 'Deadpan'
    }, {
      value: 'maximalist',
      label: 'Maximalist'
    }],
    onChange: v => setTweak('humor', v)
  })));
}
const tweaksRoot = document.getElementById('tweaks-root');
if (tweaksRoot) {
  ReactDOM.createRoot(tweaksRoot).render(/*#__PURE__*/React.createElement(SovietTweaks, null));
}
