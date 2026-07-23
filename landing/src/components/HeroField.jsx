import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const VERT = `
uniform float uTime;
attribute float aRand;
varying float vE;
varying float vFog;
void main(){
  vec3 p = position;
  float range = 23.0;
  p.z = mod(position.z + uTime * 1.3 + range * 0.5, range) - range * 0.5;
  float w  = sin(p.x * 0.5 + uTime * 0.7) * cos(p.z * 0.45 + uTime * 0.5);
  float w2 = sin((p.x + p.z) * 0.25 - uTime * 0.8);
  float e = w * 0.55 + w2 * 0.4;
  p.y += e;
  vE = e;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFog = smoothstep(20.0, 2.0, -mv.z);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (15.0 / -mv.z) * (0.55 + 0.7 * aRand);
}
`

const FRAG = `
precision highp float;
varying float vE;
varying float vFog;
void main(){
  float d = distance(gl_PointCoord, vec2(0.5));
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  vec3 mint  = vec3(0.22, 0.96, 0.62);
  vec3 cyan  = vec3(0.34, 0.82, 1.0);
  vec3 amber = vec3(1.0, 0.68, 0.3);
  vec3 col = mix(cyan, mint, smoothstep(-0.7, 0.9, vE));
  col = mix(col, amber, smoothstep(0.75, 1.1, vE) * 0.5);
  gl_FragColor = vec4(col, a * vFog * (0.35 + 0.65 * smoothstep(-0.6, 0.9, vE)));
}
`

function Field() {
  const ref = useRef(null)
  const mouse = useRef({ x: 0, y: 0 })

  const { geometry, material } = useMemo(() => {
    const SX = 72
    const SZ = 58
    const GAP = 0.42
    const count = SX * SZ
    const positions = new Float32Array(count * 3)
    const rand = new Float32Array(count)
    let i = 0
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        positions[i * 3] = (x - SX / 2) * GAP
        positions[i * 3 + 1] = 0
        positions[i * 3 + 2] = (z - SZ / 2) * GAP
        rand[i] = Math.random()
        i++
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry: geo, material: mat }
  }, [])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    const p = state.pointer
    mouse.current.x += (p.x - mouse.current.x) * 0.05
    mouse.current.y += (p.y - mouse.current.y) * 0.05
    state.camera.position.x += (mouse.current.x * 2.2 - state.camera.position.x) * 0.05
    state.camera.position.y += (2.4 - mouse.current.y * 1.2 - state.camera.position.y) * 0.05
    state.camera.lookAt(0, -0.4, -3)
  })

  return (
    <points ref={ref} geometry={geometry} material={material} rotation={[-0.32, 0, 0]} position={[0, -1.1, 0]} />
  )
}

export default function HeroField() {
  return (
    <Canvas
      className="hero-field"
      style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}
      dpr={[1, 1.6]}
      camera={{ position: [0, 2.4, 7], fov: 62 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-hidden
    >
      <Field />
    </Canvas>
  )
}
