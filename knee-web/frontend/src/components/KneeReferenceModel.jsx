import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export default function KneeReferenceModel() {
  const host = useRef(null)
  const controlsRef = useRef(null)
  const [state, setState] = useState('Loading anatomy reference…')

  useEffect(() => {
    const element = host.current
    if (!element) return undefined
    let disposed = false
    let frame = 0
    let model
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f7fafc')
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100)
    camera.position.set(0, 0, 4)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setSize(element.clientWidth, element.clientHeight)
    element.prepend(renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc5d2df, 2.1))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4)
    keyLight.position.set(2.5, 3, 4)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xb9d9f4, 1.1)
    fillLight.position.set(-3, -1, -2)
    scene.add(fillLight)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = 1
    controls.maxDistance = 8
    controlsRef.current = controls

    const resize = () => {
      const width = Math.max(1, element.clientWidth)
      const height = Math.max(1, element.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const loader = new GLTFLoader()
    loader.load('/models/knee-reference.glb', (gltf) => {
      if (disposed) return
      model = gltf.scene
      model.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(model)
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const maxDimension = Math.max(size.x, size.y, size.z)
      model.position.sub(center)
      model.scale.setScalar(2.35 / maxDimension)
      scene.add(model)
      controls.target.set(0, 0, 0)
      controls.update()
      setState('Right knee · anatomy reference')
    }, undefined, () => { if (!disposed) setState('Unable to load reference model') })

    const render = () => {
      if (disposed) return
      frame = window.requestAnimationFrame(render)
      controls.update()
      renderer.render(scene, camera)
    }
    render()
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      controlsRef.current = null
      scene.traverse((object) => {
        if (!object.isMesh) return
        object.geometry?.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          Object.values(material).forEach((value) => { if (value?.isTexture) value.dispose() })
          material.dispose()
        })
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div className="locator-stage knee-reference-model" ref={host} aria-label="Interactive generic right-knee anatomy model">
    <span className="model-status">{state}</span>
    <button type="button" className="model-reset" aria-label="Reset reference model view" title="Reset view" onClick={() => controlsRef.current?.reset()}><RotateCcw size={14} /></button>
    <span className="model-hint">Drag to rotate · scroll to zoom</span>
  </div>
}
