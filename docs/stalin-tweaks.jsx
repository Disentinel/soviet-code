// SOVIET CODE — Tweaks panel
// Loaded after react/react-dom/babel and tweaks-panel.jsx.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "humor": "maximalist"
}/*EDITMODE-END*/;

function SovietTweaks() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => {
    document.body.dataset.humor = t.humor;
  }, [t.humor]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Humor dial">
        <TweakRadio
          label="Aesthetic"
          value={t.humor}
          options={[
            { value: 'deadpan', label: 'Deadpan' },
            { value: 'maximalist', label: 'Maximalist' },
          ]}
          onChange={v => setTweak('humor', v)}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

const tweaksRoot = document.getElementById('tweaks-root');
if (tweaksRoot) {
  ReactDOM.createRoot(tweaksRoot).render(<SovietTweaks />);
}
