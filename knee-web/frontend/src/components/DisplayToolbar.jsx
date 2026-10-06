export default function DisplayToolbar({ contrast, brightness, inverted, setContrast, setBrightness, setInverted }) {
  const resetDisplay = () => {
    setContrast(1.3)
    setBrightness(0.9)
    setInverted(false)
  }

  return (
    <div className="display-toolbar">
      <span className="display-label">Image display</span>
      <label>Contrast <input aria-label="Image contrast" type="range" min="0.8" max="2" step="0.05" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} /></label>
      <span className="range-value">{contrast.toFixed(2)}</span>
      <label>Brightness <input aria-label="Image brightness" type="range" min="0.65" max="1.25" step="0.05" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label>
      <span className="range-value">{brightness.toFixed(2)}</span>
      <button className={`button ghost small ${inverted ? 'selected-control' : ''}`} onClick={() => setInverted(!inverted)}>Invert</button>
      <button className="button ghost small" onClick={resetDisplay}>Reset display</button>
    </div>
  )
}
