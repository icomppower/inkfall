import * as T from 'three';

/** World-anchored ink density avoids a noisy texture crawling over moving geometry. */
export const inkFragment = `
uniform vec3 base;
uniform vec3 mist;
uniform float wet;
uniform float hatch;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vView;
float ihash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float inoise(vec3 p) {
 vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
 return mix(mix(mix(ihash(i),ihash(i+vec3(1,0,0)),f.x),mix(ihash(i+vec3(0,1,0)),ihash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(ihash(i+vec3(0,0,1)),ihash(i+vec3(1,0,1)),f.x),mix(ihash(i+vec3(0,1,1)),ihash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main() {
 vec3 n=normalize(vNormal);
 float light=dot(n,normalize(vec3(-.6,.8,.3)));
 float wash=inoise(vWorld*.48)*.62+inoise(vWorld*1.9)*.27+inoise(vWorld*7.1)*.11;
 float fibre=ihash(floor(vWorld*vec3(19.,2.,19.)));
 float value=dot(pow(max(base,vec3(0.)),vec3(1./2.2)),vec3(.299,.587,.114));
 float red=step(base.g*2.3,base.r)*step(base.b*2.0,base.r)*step(.21,base.r);
 float density=clamp((1.-value)*1.08,0.,.93);
 float shade=(1.-smoothstep(-.4,.8,light))*.20;
 float pooling=smoothstep(.45,.82,wash)*.17;
 float dry=step(.69,fibre)*hatch*.12;
 density=clamp(density+shade+pooling-dry,0.,.96);
 density*=.85+wash*.22;
 vec3 paper=vec3(.885,.857,.785);
 vec3 pigment=mix(vec3(.017,.022,.021),vec3(.39,.033,.016),red);
 vec3 col=mix(paper,pigment,density);
 // Rough directional strokes are paint marks, rather than crosshatch screen shading.
 float strokes=smoothstep(.68,.89,.5+.5*sin(vWorld.x*3.3+vWorld.z*2.9+sin(vWorld.y*.35)));
 col=mix(col,pigment,strokes*shade*.22*hatch);
 float rim=pow(1.-abs(dot(n,normalize(cameraPosition-vWorld))),3.);
 col=mix(col,paper,rim*.12);
 float distanceFog=1.-exp(-max(0.,length(vView)-32.)/(wet>.5?205.:280.));
 float valleyMist=sin(vWorld.y*.019+vWorld.z*.002)*.04;
 col=mix(col,mist,clamp(distanceFog+valleyMist,0.,.97));
 gl_FragColor=vec4(col,1.);
}`;

export const washPostFragment = `
uniform sampler2D image;
uniform sampler2D paper;
uniform vec2 resolution;
uniform float time;
uniform float rain;
uniform float boost;
uniform float damage;
varying vec2 vUv;
float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec2 uv=vUv;
 vec2 fibreUv=vUv*resolution/512.;
 float grain=texture2D(paper,fibreUv).r;
 // The paper remains fixed, while lens drops slowly run across it.
 vec2 grid=vec2(19.,11.);vec2 cell=floor(uv*grid);vec2 f=fract(uv*grid)-.5;
 float seed=hash(cell);f.y+=sin(time*.3+seed*15.)*.07;f.x+=(seed-.5)*.4;
 float drop=length(f*vec2(1.,1.4));
 float on=step(seed,rain*.66)*step(.15,seed);
 float mask=(1.-smoothstep(.09,.16,drop))*on;
 uv+=normalize(f+vec2(.001))*.006*mask;
 vec2 px=1./resolution;
 // Imperfect edges: small paper-driven displacement, with feathered ink bleeding.
 uv+=(vec2(grain,texture2D(paper,fibreUv+vec2(.23,.17)).r)-.5)*px*1.5;
 vec3 c=texture2D(image,uv).rgb;
 vec3 ca=texture2D(image,uv+px*vec2(-1.,1.)).rgb;
 vec3 cb=texture2D(image,uv+px*vec2(0.,1.)).rgb;
 vec3 cd=texture2D(image,uv+px*vec2(1.,1.)).rgb;
 vec3 ce=texture2D(image,uv+px*vec2(-1.,0.)).rgb;
 vec3 cf=texture2D(image,uv+px*vec2(1.,0.)).rgb;
 vec3 cg=texture2D(image,uv+px*vec2(-1.,-1.)).rgb;
 vec3 ch=texture2D(image,uv+px*vec2(0.,-1.)).rgb;
 vec3 ci=texture2D(image,uv+px*vec2(1.,-1.)).rgb;
 float gx=-lum(ca)-2.*lum(ce)-lum(cg)+lum(cd)+2.*lum(cf)+lum(ci);
 float gy=-lum(ca)-2.*lum(cb)-lum(cd)+lum(cg)+2.*lum(ch)+lum(ci);
 float edge=smoothstep(.12,.78,length(vec2(gx,gy)));
 vec3 bleed=min(min(ca,cd),min(cg,ci));
 c=mix(c,min(c,bleed),(.07+rain*.07)*(.5+grain));
 c=mix(c,vec3(.025,.031,.028),edge*(.23+grain*.24));
 c=mix(c,vec3(.89,.86,.79),mask*.06);
 float vignette=smoothstep(.36,.81,distance(vUv,vec2(.5)));
 c=mix(c,c*vec3(.80,.36,.27),damage*vignette*.58);
 c*=1.-vignette*.05;
 c=pow(max(c,vec3(0.)),vec3(1./2.2));
 c*=.94+grain*.085;
 gl_FragColor=vec4(c,1.);
}`;

/** Seeded fibres and flecks: a generated paper texture, never downloaded. */
export function makePaperTexture():T.DataTexture {
 const size=512,data=new Uint8Array(size*size*4);let seed=60221;
 const rand=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 const rows=Array.from({length:size},()=>rand());
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const slow=Math.sin(x*.04+y*.031)*.05+Math.cos(x*.013-y*.026)*.04;
  const fleck=rand()>.993?-.25:0;
  const value=T.MathUtils.clamp(.6+(rand()-.5)*.44+(rows[y]-.5)*.11+slow+fleck,0,1)*255;
  const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
 }
 const texture=new T.DataTexture(data,size,size);texture.wrapS=texture.wrapT=T.RepeatWrapping;
 texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;return texture;
}

/** Jagged pine foliage catches broken brushwork along its silhouette. */
export function brushPineGeometry():T.BufferGeometry {
 const verts:number[]=[],indices:number[]=[];const sides=11,rings=5;
 for(let j=0;j<rings;j++)for(let i=0;i<sides;i++){
  const angle=i/sides*Math.PI*2;const radius=(1-j/(rings-1))*(.65+.22*Math.sin(i*17.4+j*3.2));
  verts.push(Math.cos(angle)*radius,j/(rings-1)-.5+Math.sin(i*9.1+j)*.045,Math.sin(angle)*radius);
 }
 for(let j=0;j<rings-1;j++)for(let i=0;i<sides;i++){
  const a=j*sides+i,b=j*sides+(i+1)%sides,c=a+sides,d=b+sides;indices.push(a,b,c,b,d,c);
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

/** Tall, asymmetrical stone pillars evoke a shanshui skyline. */
export function mountainGeometry(radius:number,height:number,seed:number):T.BufferGeometry {
 const verts:number[]=[],indices:number[]=[];const rings=10,sides=13;
 for(let j=0;j<=rings;j++)for(let i=0;i<sides;i++){
  const u=j/rings,a=i/sides*Math.PI*2;
  const profile=Math.pow(1-u,.36)*(1+.14*Math.sin(j*2.4+seed));
  const r=radius*profile*(.84+.16*Math.sin(i*3.7+seed)+.09*Math.sin(i*11+j));
  verts.push(Math.cos(a)*r+Math.sin(u*3+seed)*radius*.27,height*(u-.2),Math.sin(a)*r);
 }
 for(let j=0;j<rings;j++)for(let i=0;i<sides;i++){
  const a=j*sides+i,b=j*sides+(i+1)%sides;indices.push(a,a+sides,b,b,a+sides,b+sides);
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
