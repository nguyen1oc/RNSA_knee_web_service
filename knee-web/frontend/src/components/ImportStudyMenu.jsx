import { ChevronDown, FileArchive, FolderOpen, UploadCloud } from 'lucide-react'

function ImportOption({ icon: Icon, children, onClick }) {
  return (
    <button className="import-menu-option" type="button" role="menuitem" onClick={onClick}>
      <Icon size={15} />
      <span>{children}</span>
    </button>
  )
}

export default function ImportStudyMenu({ onFiles, onFolder, disabled = false, compact = false }) {
  const closeMenu = (event, action) => {
    const details = event.currentTarget.closest('details')
    if (details) details.open = false
    action()
  }

  return (
    <details className={`import-menu${compact ? ' compact' : ''}`}>
      <summary
        className="button primary"
        aria-label="Import study"
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault()
        }}
      >
        <UploadCloud size={16} /> Import study <ChevronDown size={14} />
      </summary>
      <div className="import-menu-options" role="menu" aria-label="Choose study import type">
        <ImportOption icon={FileArchive} onClick={(event) => closeMenu(event, onFiles)}>
          DICOM files or ZIP
        </ImportOption>
        <ImportOption icon={FolderOpen} onClick={(event) => closeMenu(event, onFolder)}>
          Folder of DICOM files
        </ImportOption>
      </div>
    </details>
  )
}
