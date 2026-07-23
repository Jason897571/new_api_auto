import { useEffect, useRef } from 'react'

/**
 * Full-screen living aurora rendered with a single WebGL fragment shader
 * (domain-warped simplex fbm). No three.js — hand-written, ~1 draw call.
 * Falls back silently to the CSS gradient on .bg-shader if WebGL is absent.
 */
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  m=m*m; m=m*m;
  vec3 x=2.0*fract(p*C.www)-1.0;
  vec3 h=abs(x)-0.5;
  vec3 ox=floor(x+0.5);
  vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.0*dot(m,g);
}
float fbm(vec2 p){
  float s=0.0,a=0.5;
  for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.0; a*=0.5; }
  return s;
}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy;
  vec2 p=(gl_FragCoord.xy-0.5*u_res.xy)/u_res.y;
  float t=u_time*0.045;
  vec2 q=vec2(fbm(p*1.5+t), fbm(p*1.5-t+3.1));
  float n=fbm(p*2.0+q*1.6+vec2(0.0,t*2.0));
  float band=smoothstep(0.05,0.95,0.5+0.5*sin(p.y*2.6+n*3.2+t*3.4));
  vec3 emerald=vec3(0.12,0.86,0.55);
  vec3 cyan=vec3(0.20,0.72,0.96);
  vec3 amber=vec3(1.0,0.62,0.25);
  vec3 col=mix(emerald,cyan,0.5+0.5*n);
  col=mix(col,amber,smoothstep(0.72,1.0,band)*0.3);
  float glow=pow(band,2.2);
  col*=0.12+0.95*glow;
  float d=distance(uv,u_mouse);
  col+=emerald*0.16*exp(-d*4.5);
  vec3 base=vec3(0.023,0.037,0.033);
  col=base+col*0.62;
  float vig=smoothstep(1.35,0.15,length(p));
  col*=mix(0.55,1.0,vig);
  gl_FragColor=vec4(col,1.0);
}
`

const VERT = `
attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }
`

export default function ShaderBackground() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const gl =
      canvas.getContext('webgl', { antialias: false, alpha: false }) ||
      canvas.getContext('experimental-webgl')
    if (!gl) return // CSS gradient fallback stays visible

    const compile = (type, src) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )
    const loc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, 'u_res')
    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uMouse = gl.getUniformLocation(prog, 'u_mouse')

    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 }
    const onMove = (e) => {
      mouse.tx = e.clientX / window.innerWidth
      mouse.ty = 1 - e.clientY / window.innerHeight
    }
    window.addEventListener('pointermove', onMove)

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)

    let raf
    const start = performance.now()
    const render = (now) => {
      mouse.x += (mouse.tx - mouse.x) * 0.06
      mouse.y += (mouse.ty - mouse.y) * 0.06
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, (now - start) / 1000)
      gl.uniform2f(uMouse, mouse.x, mouse.y)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  return <canvas ref={ref} className="bg-shader" aria-hidden="true" />
}
