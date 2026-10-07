export default function OrientationLabels({ labels = [] }) {
  return labels.map((label, index) => <span key={index} className={`patient-edge patient-edge-${index}`}>{label}</span>)
}
