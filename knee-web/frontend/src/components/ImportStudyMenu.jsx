import { ChevronDown, FileArchive, FolderOpen, UploadCloud } from 'lucide-react'

function ImportOption({ icon: Icon, children, onClick }) {
  return (
    <button className="import-menu-option" type="button" role="menuitem" onClick={(event) => {
      const menu = event.currentTarget.closest('details')
      if (menu) menu.open = false
      onClick()
    }}>
      <Icon size={15} />
      <span>{children}</span>
    </button>
  )
}

export default function ImportStudyMenu({ onFiles, onFolder, disabled = false, compact = false }) {
  return (
    <details className={`import-menu${compact ? ' compact' : ''}`}>
      <summary className="button primary" aria-label="Import study" aria-disabled={disabled} onClick={(event) => {
        if (disabled) event.preventDefault()
      }}>
        <UploadCloud size={16} /> Import study <ChevronDown size={14} />
      </summary>
      <div className="import-menu-options" role="menu" aria-label="Choose import source">
        <ImportOption icon={FileArchive} onClick={onFiles}>Files / ZIP</ImportOption>
        <ImportOption icon={FolderOpen} onClick={onFolder}>Folder</ImportOption>
      </div>
    </details>
  )
}
