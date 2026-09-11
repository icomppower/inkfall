import * as T from 'three';
import {inkFragment,brushPineGeometry,mountainGeometry} from './ink';
import {LENGTH,clamp,rampHeight,ramps} from './physics';
export const ink=0x292c28;
let seed=38177;export function random(){seed=(seed*16807)%2147483647;return(seed-1)/2147483646;}
export class Track{
 curve:T.CatmullRomCurve3; scale:number; points:T.Vector3[]=[];
 constructor(){const pts=[];for(let i=0;i<=46;i++){const z=i*50;pts.push(new T.Vector3(36*Math.sin(z/170)+24*Math.sin(z/77),-z*.223,-z));}this.curve=new T.CatmullRomCurve3(pts);this.curve.arcLengthDivisions=6000;this.scale=LENGTH/this.curve.getLength();for(let i=0;i<=4600;i++)this.points.push(this.curve.getPointAt(i/4600).multiplyScalar(this.scale));}
 center(s:number){const v=clamp(s,0,LENGTH)/LENGTH*4600,i=Math.min(4599,Math.floor(v));const p=this.points[i].clone().lerp(this.points[i+1],v-i);if(s<0)p.add(this.tangent(0).multiplyScalar(s));if(s>LENGTH)p.add(this.tangent(LENGTH).multiplyScalar(s-LENGTH));return p;}
 tangent(s:number){const i=clamp(Math.round(s/LENGTH*4600),1,4599);return this.points[i+1].clone().sub(this.points[i-1]).normalize();}
 right(s:number){const f=this.tangent(s);return new T.Vector3(-f.z,0,f.x).normalize();}
 terrain(s:number,l:number){const a=Math.abs(l);return this.center(s).y+(a<5.7?rampHeight(s)+.07*Math.sin(s*1.8)*Math.sin(l*.8):Math.max(0,a-6)*(.13+(l<0?.42:-.02))+(Math.sin(s*.083+l*.1)*2+Math.cos(s*.031-l*.2)*3)*Math.min(1,(a-5.7)/10));}
 pos(s:number,l:number,y?:number){const p=this.center(s).add(this.right(s).multiplyScalar(l));p.y=y??this.terrain(s,l);return p;}
 curvature(s:number){const a=this.tangent(s-6),b=this.tangent(s+6);return Math.atan2(a.x*b.z-a.z*b.x,a.dot(b));}
}
const vertex=`varying vec3 vNormal;varying vec3 vWorld;varying vec3 vView;void main(){vec4 p=vec4(position,1.);vec3 n=normal;
#ifdef USE_INSTANCING
p=instanceMatrix*p;n=mat3(instanceMatrix)*n;
#endif
vec4 w=modelMatrix*p;vWorld=w.xyz;vNormal=normalize(mat3(modelMatrix)*n);vec4 mv=viewMatrix*w;vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`;
const fragment=inkFragment;
export type Palette={materials:T.ShaderMaterial[];mat:(c:number,h?:number)=>T.ShaderMaterial};
export function palette():Palette{const materials:T.ShaderMaterial[]=[];const cache=new Map<string,T.ShaderMaterial>();return{materials,mat(c,h=1){const key=c+':'+h;if(cache.has(key))return cache.get(key)!;const m=new T.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:{base:{value:new T.Color(c)},mist:{value:new T.Color(0xf1eddf)},wet:{value:0},hatch:{value:h}},side:T.DoubleSide});materials.push(m);cache.set(key,m);return m;}};}
function ribbon(track:Track,from:number,to:number,left:number,right:number,step:number,color:number,p:Palette){const pos:number[]=[],indices:number[]=[];const seg=Math.ceil((to-from)/step);for(let i=0;i<=seg;i++){const s=from+(to-from)*i/seg;for(const l of [left,right]){const v=track.pos(s,l);pos.push(v.x,v.y+(Math.abs(l)<5.8?.015:0),v.z);}}for(let i=0;i<seg;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(indices);geo.computeVertexNormals();return new T.Mesh(geo,p.mat(color));}
export function cylinderBetween(a:T.Vector3,b:T.Vector3,r:number,mat:T.Material,parent:T.Object3D){const m=new T.Mesh(new T.CylinderGeometry(r,r,a.distanceTo(b),6),mat);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());parent.add(m);return m;}
export function buildWorld(scene:T.Scene,track:Track,p:Palette){
 // Ribbon strips share the exact height function used by both wheel contacts.
 const widths=[-150,-85,-45,-24,-13,-8,-5.7,-5.2,-2.5,0,2.5,5.2,5.7,8,13,24,45,85,150];
 for(let i=0;i<widths.length-1;i++){const a=widths[i],b=widths[i+1],road=Math.abs(a)<5.8&&Math.abs(b)<5.8;const c=road?(i%2?0xb8b89a:0xc5c3a1):i<6?[0x37565a,0x466565,0x52766d][i%3]:[0x3e655d,0x507768,0x658576][i%3];scene.add(ribbon(track,-35,LENGTH+75,a,b,road?1:5,c,p));}
 for(const side of [-1,1])scene.add(ribbon(track,-20,LENGTH+35,side*5.1,side*5.17,2,0x666c54,p));
 // Instanced conifers, generated rock formations and broken timber rails.
 const leaves=new T.InstancedMesh(brushPineGeometry(),p.mat(0x254f49),2400),trunks=new T.InstancedMesh(new T.CylinderGeometry(.10,.18,1,5),p.mat(0x354843),800),rocks=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),p.mat(0x6f817c),400);
 const dummy=new T.Object3D();for(let i=0;i<800;i++){const s=random()*(LENGTH+70)-25,l=(random()>.5?1:-1)*(10+Math.pow(random(),1.5)*93),h=5+random()*13,base=track.pos(s,l);dummy.position.copy(base).add(new T.Vector3(0,h*.25,0));dummy.scale.set(1,h*.5,1);dummy.rotation.set(0,random()*6.28,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);for(let j=0;j<3;j++){dummy.position.copy(base).add(new T.Vector3(0,h*(.43+j*.20),0));dummy.scale.set(h*(.32-j*.065),h*.58,h*(.32-j*.065));dummy.updateMatrix();leaves.setMatrixAt(i*3+j,dummy.matrix);}}
 for(let i=0;i<400;i++){const s=random()*LENGTH,l=(random()>.5?1:-1)*(7.4+random()*50);dummy.position.copy(track.pos(s,l));dummy.rotation.set(random(),random()*6,random());dummy.scale.set(1+random()*5,1+random()*5,1+random()*5);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);}scene.add(leaves,trunks,rocks);
 const poleGeo=new T.BoxGeometry(.12,1.3,.12),railGeo=new T.BoxGeometry(.08,.10,5.2);const posts=new T.InstancedMesh(poleGeo,p.mat(0xddd6ad),300),rails=new T.InstancedMesh(railGeo,p.mat(0xd5c899),300);let n=0;
 for(let s=0;s<LENGTH;s+=8){if(Math.abs(track.curvature(s))<.025&&s>60)continue;if(n>=300)break;const side=track.curvature(s)>0?1:-1;dummy.position.copy(track.pos(s,side*6.6)).add(new T.Vector3(0,.65,0));dummy.rotation.set(0,Math.atan2(-track.tangent(s).x,-track.tangent(s).z),0);dummy.scale.set(1,1,1);dummy.updateMatrix();posts.setMatrixAt(n,dummy.matrix);dummy.position.copy(track.pos(s-2.5,side*6.6)).add(new T.Vector3(0,1.1,0));dummy.updateMatrix();rails.setMatrixAt(n,dummy.matrix);n++;}posts.count=n;rails.count=n;scene.add(posts,rails);
 // A long, dramatic skyline; no image-based skybox.
 for(let i=0;i<35;i++){const s=i*90-150,l=(i%2?1:-1)*(180+random()*190),mountain=new T.Mesh(mountainGeometry(45+random()*65,190+random()*260,i*3.17),p.mat(i%2?0x5f7c7d:0x6f8b88));mountain.position.copy(track.pos(s,l));mountain.position.y+=45;mountain.rotation.y=random()*6;scene.add(mountain);}
 const sun=new T.Mesh(new T.CircleGeometry(29,64),new T.MeshBasicMaterial({color:0xb44837,fog:false}));sun.position.set(135,100,-480);scene.add(sun);
 for(const s of ramps){for(const l of [-5.65,5.65]){const post=new T.Mesh(new T.CylinderGeometry(.05,.05,2.9,5),p.mat(0x172e32));post.position.copy(track.pos(s-9,l)).add(new T.Vector3(0,1.4,0));scene.add(post);const flag=new T.Mesh(new T.PlaneGeometry(.8,.7),p.mat(0xa83d2c,0));flag.position.copy(post.position).add(new T.Vector3(.4,1,0));scene.add(flag);}}
 for(const s of [0,LENGTH]){const g=new T.Group(),metal=p.mat(0x1b3439);for(const x of [-6.1,6.1])cylinderBetween(new T.Vector3(x,0,0),new T.Vector3(x,6.3,0),.14,metal,g);const sign=new T.Mesh(new T.BoxGeometry(12.5,1.1,.18),p.mat(0xddd8c7,0));sign.position.y=5.9;g.add(sign);
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#e8e3d2';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#30332e';ctx.font='700 66px serif';ctx.textAlign='center';ctx.fillText(s===0?'墨 落 · 入 山':'墨 落 · 抵 達',512,90);const tx=new T.CanvasTexture(canvas);tx.colorSpace=T.SRGBColorSpace;const face=new T.Mesh(new T.PlaneGeometry(12.4,1.05),new T.MeshBasicMaterial({map:tx,side:T.DoubleSide}));face.position.set(0,5.9,.11);g.add(face);g.position.copy(track.pos(s,0));g.rotation.y=Math.atan2(-track.tangent(s).x,-track.tangent(s).z);scene.add(g);}
 // Chunky white finish grid.
 for(let i=0;i<12;i++)for(let j=0;j<4;j++){if((i+j)%2)continue;const m=new T.Mesh(new T.PlaneGeometry(.86,.8),p.mat(0xf0edd6,0));m.rotation.x=-Math.PI/2;m.position.copy(track.pos(LENGTH-1.5+j*.8,-5+i*.9)).add(new T.Vector3(0,.07,0));scene.add(m);}
}
export type RiderModel={root:T.Group;body:T.Group;wheels:T.Group[];cranks:T.Group;forks:T.Mesh[];shadow:T.Mesh;name:string;color:string};
export function createRider(scene:T.Scene,p:Palette,name:string,color:string):RiderModel{
 const root=new T.Group(),body=new T.Group();root.add(body);const dark=p.mat(0x142a30),paint=p.mat(new T.Color(color).getHex()),skin=p.mat(0xd3ac84),cream=p.mat(0xe4e3ce);const v=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
 const frame=[[[0,-.50,.94],[0,.16,.27]],[[0,.16,.27],[0,-.48,-.06]],[[0,-.48,-.06],[0,-.50,.94]],[[0,.16,.27],[0,.24,-.69]],[[0,.24,-.69],[0,-.48,-.06]]];
 for(const [a,b]of frame)cylinderBetween(v(...a as [number,number,number]),v(...b as [number,number,number]),.065,paint,body);
 const forks:T.Mesh[]=[];for(const x of [-.12,.12])forks.push(cylinderBetween(v(x,.30,-.72),v(x,-.5,-.98),.055,cream,body));
 cylinderBetween(v(0,.2,-.71),v(0,.61,-.83),.065,dark,body);cylinderBetween(v(-.48,.62,-.83),v(.48,.62,-.83),.06,dark,body);
 const seat=new T.Mesh(new T.BoxGeometry(.29,.09,.4),dark);seat.position.set(0,.25,.26);body.add(seat);
 const wheels:T.Group[]=[];for(const z of [.94,-.98]){const w=new T.Group();w.position.set(0,-.5,z);const tire=new T.Mesh(new T.TorusGeometry(.43,.095,6,18),dark);tire.rotation.y=Math.PI/2;w.add(tire);const rim=new T.Mesh(new T.TorusGeometry(.355,.023,4,18),cream);rim.rotation.y=Math.PI/2;w.add(rim);for(let i=0;i<10;i++){const a=i*Math.PI/5;cylinderBetween(v(0,0,0),v(0,Math.cos(a)*.35,Math.sin(a)*.35),.012,cream,w);}body.add(w);wheels.push(w);}
 const cranks=new T.Group();cranks.position.set(0,-.43,-.02);cylinderBetween(v(-.23,-.15,0),v(.23,.15,0),.035,dark,cranks);body.add(cranks);
 // Rider: articulated silhouette, bent arms and legs, full-face helmet.
 const torso=new T.Mesh(new T.CylinderGeometry(.24,.19,.64,7),paint);torso.position.set(0,.79,.03);torso.rotation.x=-.55;body.add(torso);
 const hips=v(0,.52,.20),knees=[v(-.25,.02,-.34),v(.25,.08,.02)],feet=[v(-.23,-.53,-.02),v(.23,-.36,.05)];for(let i=0;i<2;i++){cylinderBetween(hips,knees[i],.12,dark,body);cylinderBetween(knees[i],feet[i],.09,dark,body);const shoe=new T.Mesh(new T.BoxGeometry(.17,.13,.29),cream);shoe.position.copy(feet[i]);body.add(shoe);}
 for(const x of [-1,1]){cylinderBetween(v(x*.21,1.03,-.16),v(x*.36,.75,-.44),.085,paint,body);cylinderBetween(v(x*.36,.75,-.44),v(x*.43,.64,-.82),.065,skin,body);}
 const helmet=new T.Mesh(new T.SphereGeometry(.27,9,7),paint);helmet.position.set(0,1.27,-.31);helmet.scale.set(1,1.05,1.12);body.add(helmet);const visor=new T.Mesh(new T.BoxGeometry(.42,.13,.12),dark);visor.position.set(0,1.29,-.55);body.add(visor);const brim=new T.Mesh(new T.BoxGeometry(.48,.055,.36),paint);brim.position.set(0,1.44,-.49);brim.rotation.x=.12;body.add(brim);
 const backpack=new T.Mesh(new T.BoxGeometry(.31,.39,.19),dark);backpack.position.set(0,.90,.27);backpack.rotation.x=-.5;body.add(backpack);
 // Inverted hull outlines for the rider; post Sobel handles terrain silhouettes.
 const meshes:T.Mesh[]=[];body.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o)});const outlineMat=new T.MeshBasicMaterial({color:ink,side:T.BackSide});for(const m of meshes){const shell=new T.Mesh(m.geometry,outlineMat);shell.scale.setScalar(1.055);m.add(shell);}
 const shadow=new T.Mesh(new T.CircleGeometry(1.4,20),new T.MeshBasicMaterial({color:0x292d28,transparent:true,opacity:.27,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.set(.7,1,1);scene.add(shadow);scene.add(root);return{root,body,wheels,cranks,forks,shadow,name,color};
}
