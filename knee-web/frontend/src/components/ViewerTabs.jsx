export default function ViewerTabs({ tabs, activeTab, onChange }) {
  return (
    <nav className="viewer-tabs" aria-label="Viewer tabs">
      {tabs.map((tab) => (
        <button key={tab.label} className={`viewer-tab ${activeTab === tab.label ? 'active' : ''}`} onClick={() => onChange(tab)}>
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
