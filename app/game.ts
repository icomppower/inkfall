import * as T from 'three';
import {washPostFragment,makePaperTexture} from './ink';
import {Track,palette,buildWorld,createRider,type RiderModel} from './world';
import {LENGTH,clamp,makeState,stepBike,crash,type BikeState,type Input} from './physics';
import {Soundtrack} from './audio';
export type HUD={speed:number;progress:number;time:number;rank:number;boost:number;rain:number;trick:string;score:number;status:string;suspension:number[];mapPath:string;elevation:number;riders:{name:string;color:string;gap:string}[]};
export type GameAPI={start:()=>void;pause:()=>void;mute:(v:boolean)=>void;key:(k:string,v:boolean)=>void;dispose:()=>void};
const postVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const postFragment=washPostFragment;
export function createGame(container:HTMLDivElement,onHUD:(h:HUD)=>void):GameAPI{
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio,window.matchMedia('(pointer:coarse)').matches?1.2:1.5,Math.sqrt(2300000/(window.innerWidth*window.innerHeight))));renderer.outputColorSpace=T.SRGBColorSpace;container.appendChild(renderer.domElement);
 const fx=document.createElement('canvas');container.appendChild(fx);const ctx=fx.getContext('2d')!;
 const scene=new T.Scene();scene.background=new T.Color(0xf1eddf);const camera=new T.PerspectiveCamera(61,1,.1,1200),track=new Track(),pal=palette();buildWorld(scene,track,pal);
 const mapPoints=Array.from({length:121},(_,i)=>track.center(i/120*LENGTH));const minX=Math.min(...mapPoints.map(v=>v.x)),maxX=Math.max(...mapPoints.map(v=>v.x));const mapPath=mapPoints.map((v,i)=>`${i?'L':'M'}${(12+(v.x-minX)/(maxX-minX)*76).toFixed(1)} ${(12+i/120*254).toFixed(1)}`).join(' ');
 const playerModel=createRider(scene,pal,'YOU','#a43f30');const rivals=[{name:'ROOK',color:'#665f4f',style:0},{name:'GHOST',color:'#898b82',style:1},{name:'JINX',color:'#444b49',style:2}].map((r,i)=>({...r,state:makeState((s,l)=>track.terrain(s,l),3+i*3,(i-1)*2.3),model:createRider(scene,pal,r.name,r.color),finishedAt:0}));
 const ground=(s:number,l:number)=>track.terrain(s,l);let player=makeState(ground,0,0),status='ready',elapsed=0,worldTime=0,last=performance.now(),accumulator=0,frame=0,hudTimer=0,disposed=false,trick='',trickUntil=0,lastCrash=false,weather=.15,lastHop=false,rank=4;
 const keys=new Set<string>(),sound=new Soundtrack();
 const paperTexture=makePaperTexture();const target=new T.WebGLRenderTarget(1,1,{depthBuffer:true});const post=new T.ShaderMaterial({vertexShader:postVertex,fragmentShader:postFragment,uniforms:{image:{value:target.texture},paper:{value:paperTexture},resolution:{value:new T.Vector2(1,1)},time:{value:0},rain:{value:0},boost:{value:0},damage:{value:0}},depthTest:false,depthWrite:false});const postScene=new T.Scene();postScene.add(new T.Mesh(new T.PlaneGeometry(2,2),post));const postCamera=new T.Camera();
 const look=new T.Vector3(),cameraPos=new T.Vector3();let cameraInitialized=false,width=0,height=0;
 function resize(){width=container.clientWidth;height=container.clientHeight;renderer.setSize(width,height);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();const size=renderer.getDrawingBufferSize(new T.Vector2());target.setSize(size.x,size.y);post.uniforms.resolution.value.copy(size);fx.width=width;fx.height=height;}
 const ro=new ResizeObserver(resize);ro.observe(container);resize();
 // Reusable particles: dust, wet wheel spray, and warm boost sparks.
 const particleCount=360,positions=new Float32Array(particleCount*3),colors=new Float32Array(particleCount*3),vels=new Float32Array(particleCount*3),life=new Float32Array(particleCount);positions.fill(-10000);let particleIndex=0;
 const pg=new T.BufferGeometry();pg.setAttribute('position',new T.BufferAttribute(positions,3));pg.setAttribute('color',new T.BufferAttribute(colors,3));const particleMat=new T.PointsMaterial({size:.15,vertexColors:true,transparent:true,opacity:.8,depthWrite:false});const particles=new T.Points(pg,particleMat);particles.frustumCulled=false;scene.add(particles);
 const rainPositions=new Float32Array(420*6);const rainGeo=new T.BufferGeometry();rainGeo.setAttribute('position',new T.BufferAttribute(rainPositions,3));const rainMat=new T.LineBasicMaterial({color:0x5d6964,transparent:true,opacity:0,depthWrite:false});const rainLines=new T.LineSegments(rainGeo,rainMat);rainLines.frustumCulled=false;scene.add(rainLines);
 // Thin, persistent tyre strokes make braking read as ink on the trail.
 const skidPositions=new Float32Array(240*6);skidPositions.fill(-10000);let skidIndex=0;
 const skidGeometry=new T.BufferGeometry();skidGeometry.setAttribute('position',new T.BufferAttribute(skidPositions,3));
 const skidLines=new T.LineSegments(skidGeometry,new T.LineBasicMaterial({color:0x31372c,transparent:true,opacity:.48,depthWrite:false}));skidLines.frustumCulled=false;scene.add(skidLines);
 const droplets=Array.from({length:36},(_,i)=>({x:Math.sin(i*87.4)*.5+.5,y:Math.cos(i*23.2)*.5+.5,r:2+(i%5)*1.5}));
 function spawnParticle(boost:boolean){const i=particleIndex++%particleCount,pos=track.pos(player.s-.8,player.l,player.y-.8),right=track.right(player.s),back=track.tangent(player.s).multiplyScalar(-1);positions.set([pos.x,pos.y,pos.z],i*3);const v=back.multiplyScalar(boost?6:1.5).add(right.multiplyScalar((Math.random()-.5)*3));vels.set([v.x,1+Math.random()*2,v.z],i*3);life[i]=.4+Math.random()*.55;colors.set(boost?[.40,.055,.023]:weather>.45?[.075,.087,.080]:[.030,.036,.030],i*3);}
 function setKey(k:string,v:boolean){const normalized=k==='Shift'?'shift':k.toLowerCase();if(v)keys.add(normalized);else keys.delete(normalized);}
 function pause(){if(status==='racing'||status==='crashed'){status='paused';keys.clear();sound.pause(true);}else if(status==='paused'){status=player.crash>0?'crashed':'racing';sound.pause(false);}publish();}
 function keyDown(e:KeyboardEvent){if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.code==='Escape'&&!e.repeat){pause();return;}if(e.code==='KeyR'&&!e.repeat){start();return;}setKey(e.key,true);}
 function keyUp(e:KeyboardEvent){setKey(e.key,false)}
 function blur(){keys.clear();if(status==='racing'||status==='crashed')pause();}
 window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',blur);const visibility=()=>{if(document.hidden)blur()};document.addEventListener('visibilitychange',visibility);
 function start(){player=makeState(ground);for(let i=0;i<rivals.length;i++){rivals[i].state=makeState(ground,3+i*3,(i-1)*2.3);rivals[i].finishedAt=0;}elapsed=0;status='racing';skidPositions.fill(-10000);skidGeometry.attributes.position.needsUpdate=true;accumulator=0;trick='';rank=4;keys.clear();lastHop=false;lastCrash=false;cameraInitialized=false;sound.start();publish();}
 function publish(){const all=[{name:'YOU',color:'#a43f30',s:player.s,finishedAt:status==='finished'?elapsed:0},...rivals.map(r=>({name:r.name,color:r.color,s:r.state.s,finishedAt:r.finishedAt}))].sort((a,b)=>a.finishedAt&&b.finishedAt?a.finishedAt-b.finishedAt:a.finishedAt?-1:b.finishedAt?1:b.s-a.s);rank=all.findIndex(r=>r.name==='YOU')+1;onHUD({mapPath,elevation:Math.round(track.center(0).y-track.center(LENGTH).y),speed:player.speed*3.6,progress:player.s/LENGTH,time:elapsed,rank,boost:player.boost,rain:weather,trick:worldTime<trickUntil?trick:'',score:player.score,status,suspension:[player.front,player.rear],riders:all.map(r=>({name:r.name,color:r.color,gap:r.name==='YOU'?'':r.finishedAt?'FIN':`${r.s>=player.s?'+':'−'}${Math.abs(r.s-player.s).toFixed(0)}m`}))});}
 function updateModel(model:RiderModel,b:BikeState,dt:number){const forward=track.tangent(b.s);model.root.position.copy(track.pos(b.s,b.l,b.y));model.root.rotation.set(0,Math.atan2(-forward.x,-forward.z)-b.lv*.045,0);model.body.rotation.set(b.pitch,0,clamp(b.lv*.065,-.55,.55));if(b.crash>0){model.body.rotation.z=1.5;model.body.rotation.x+=worldTime*7;model.root.position.y=ground(b.s,b.l)+.8;}
 for(let i=0;i<2;i++){const wheel=model.wheels[i],compression=i===0?b.rear:b.front;wheel.position.y=-.64+compression;wheel.rotation.x-=b.speed*dt/.43;}model.cranks.rotation.x-=b.speed*dt*1.2;
 model.shadow.position.copy(track.pos(b.s,b.l)).add(new T.Vector3(0,.08,0));const shadowMat=model.shadow.material as T.MeshBasicMaterial;shadowMat.opacity=clamp(.34-(b.y-ground(b.s,b.l))*.055,.03,.30);model.shadow.scale.set(.7+Math.max(0,b.y-ground(b.s,b.l)-1)*.08,1.2,1);}
 function physics(dt:number){elapsed+=dt;weather=clamp(.25+.6*Math.sin(elapsed*.021+.05)+.2*Math.sin(elapsed*.07),0,1);
 const hop=keys.has(' '),input:Input={pedal:keys.has('w')||keys.has('arrowup'),brake:keys.has('s')||keys.has('arrowdown'),steer:Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')),boost:keys.has('shift'),hop:hop&&!lastHop,trick:Number(keys.has('e'))-Number(keys.has('q'))};lastHop=hop;
 stepBike(player,input,dt,weather,ground);
 if(player.crash>0&&!lastCrash){sound.hit();trick='WIPED OUT';trickUntil=worldTime+2;status='crashed';}if(player.crash<=0&&lastCrash){status='racing';}lastCrash=player.crash>0;
 if(player.landed){sound.land();trick=trick.includes('FLIP')?trick+' · LANDED':'CLEAN LANDING';trickUntil=worldTime+1.5;}
 if(player.air&&player.airtime>.2){trick=player.tricks?`${player.tricks>1?'DOUBLE ':''}${player.rotation>0?'BACKFLIP':'FRONTFLIP'}`:`AIRTIME ${player.airtime.toFixed(1)}s`;trickUntil=worldTime+.3;}
 if(player.slip>.45&&!player.air&&player.speed>8&&player.crash<=0){player.score+=Math.round(dt*130);if(worldTime>trickUntil){trick='BRAKE SLIDE';trickUntil=worldTime+.5;}}
 for(const r of rivals){const b=r.state;if(r.finishedAt)continue;const curve=track.curvature(b.s+12);let line=r.style===0?clamp(-curve*25,-3.8,3.8):r.style===1?Math.sin(b.s*.014)*1.5:Math.sin(b.s*.031)*3.2;
 // Avoid the rider ahead within the road; all opponents use the same contact physics.
 if(Math.abs(b.s-player.s)<5&&Math.abs(line-player.l)<1.2)line=clamp(player.l+(b.l>=player.l?1.6:-1.6),-4.3,4.3);
 const desired=19+(r.style===2?2:0)-Math.abs(curve)*38-weather*(r.style===1?2.5:.8);stepBike(b,{pedal:true,brake:b.speed>desired,steer:clamp((line-b.l)*.8-b.lv*.16,-1,1),boost:r.style===2&&b.boost>25&&Math.abs(curve)<.025,hop:r.style===2&&Math.floor(b.s)%180===80&&b.hopCooldown===0,trick:0},dt,weather,ground);if(b.s>=LENGTH)r.finishedAt=elapsed;
 if(Math.abs(b.s-player.s)<1.3&&Math.abs(b.l-player.l)<.55&&!b.air&&!player.air&&player.crash<=0){player.lv+=(player.l>=b.l?1:-1)*dt*16;player.speed=Math.max(0,player.speed-dt*5);}}
 if(player.s>=LENGTH){status='finished';player.speed=0;keys.clear();sound.pause(true);publish();}
 }
 function drawFX(dt:number,boosting:boolean){ctx.clearRect(0,0,width,height);const moving=status==='racing'||status==='crashed';
 if(weather>.3){ctx.lineWidth=.8;ctx.strokeStyle=`rgba(52,64,57,${weather*.18})`;ctx.beginPath();for(let i=0;i<70;i++){const x=((i*147.73+worldTime*97)%width),y=((i*93.7+worldTime*750)%height);ctx.moveTo(x,y);ctx.lineTo(x-9,y+23+player.speed);}ctx.stroke();
 for(let i=0;i<droplets.length*weather;i++){const d=droplets[i];if(moving)d.y-=dt*(.005+player.speed*.0004)*(1+i%3);if(d.y<-.02)d.y=1.02;const x=d.x*width,y=d.y*height;ctx.fillStyle='rgba(74,82,70,.025)';ctx.strokeStyle='rgba(82,90,77,.2)';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(x,y,d.r,d.r*1.45,-.2,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.strokeStyle='rgba(249,247,234,.5)';ctx.arc(x-d.r*.2,y-d.r*.4,d.r*.4,3.4,5.5);ctx.stroke();}}
 const speedAmount=clamp((player.speed-13)/20,0,1);if(moving&&speedAmount>0){ctx.strokeStyle=boosting?'rgba(146,51,34,.52)':`rgba(41,49,40,${speedAmount*.34})`;ctx.lineWidth=boosting?2.6:1.3;ctx.beginPath();for(let i=0;i<32;i++){const a=i*2.399,phase=(worldTime*(boosting?2.2:1.3)+i*.17)%1,r=.3+phase*.65,cx=width*.53,cy=height*.48,dx=Math.cos(a)*width*.75,dy=Math.sin(a)*height*.8;ctx.moveTo(cx+dx*r,cy+dy*r);ctx.lineTo(cx+dx*(r+.035+speedAmount*.10),cy+dy*(r+.035+speedAmount*.10));}ctx.stroke();}
 }
 function animate(now:number){if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min((now-last)/1000,.05);last=now;if(status!=='paused')worldTime+=dt;
 const running=status==='racing'||status==='crashed';if(running){accumulator+=dt;while(accumulator>=1/120){physics(1/120);accumulator-=1/120;if(status==='finished')break;}}
 const boosting=running&&keys.has('shift')&&player.boost>1&&player.speed>2;
 updateModel(playerModel,player,running?dt:0);for(const r of rivals)updateModel(r.model,r.state,running?dt:0);
 const intro=status==='ready'||status==='finished',s=player.s;const right=track.right(s),forward=track.tangent(s);
 const desired=track.pos(s-(intro?7:8.7),intro?-5.4:player.l*.66,(intro?ground(s,0):player.y)+(intro?3.4:3.2));
 desired.add(right.clone().multiplyScalar(intro?0:Math.sin(worldTime*.8)*.12));
 const desiredLook=track.pos(s+(intro?3:7),intro?-2.9:player.l*.73,(intro?ground(s+3,0):player.y)+.45);
 if(!cameraInitialized){cameraPos.copy(desired);look.copy(desiredLook);cameraInitialized=true;}cameraPos.lerp(desired,1-Math.exp(-dt*(intro?2.5:5.5)));look.lerp(desiredLook,1-Math.exp(-dt*6));camera.position.copy(cameraPos);if(boosting)camera.position.addScaledVector(right,Math.sin(worldTime*55)*.025);camera.lookAt(look);camera.rotateZ(intro?-.025:clamp(-player.lv*.012,-.07,.07));camera.fov=T.MathUtils.lerp(camera.fov,intro?57:61+player.speed*.30+(boosting?7:0),dt*4);camera.updateProjectionMatrix();
 const fog=new T.Color().lerpColors(new T.Color(0xf3efe3),new T.Color(0xdadbd1),weather);scene.background=fog;for(const m of pal.materials){m.uniforms.mist.value.copy(fog);m.uniforms.wet.value=weather;}
 if(running&&player.slip>.28&&player.speed>5&&!player.air&&player.crash<=0){
  const a=track.pos(player.s-1.05,player.l),b=track.pos(player.s-1.05-player.speed*dt,player.l-player.lv*dt);
  skidPositions.set([a.x,a.y+.055,a.z,b.x,b.y+.055,b.z],(skidIndex++%240)*6);skidGeometry.attributes.position.needsUpdate=true;
 }
 if(running&&player.speed>3&&!player.air&&player.crash<=0){const count=boosting?5:player.slip>.4?4:1;for(let i=0;i<count;i++)spawnParticle(boosting);}
 for(let i=0;i<particleCount;i++){if(life[i]<=0)continue;life[i]-=dt;for(let j=0;j<3;j++)positions[i*3+j]+=vels[i*3+j]*dt;vels[i*3+1]-=dt*3;if(life[i]<=0)positions[i*3+1]=-10000;}pg.attributes.position.needsUpdate=true;pg.attributes.color.needsUpdate=true;
 rainMat.opacity=weather*.28;for(let i=0;i<420;i++){const x=Math.sin(i*67.2)*28,z=Math.cos(i*42.4)*30,y=((i*.87-worldTime*22)%24+24)%24;rainPositions.set([camera.position.x+x,camera.position.y+y-10,camera.position.z+z,camera.position.x+x-.2,camera.position.y+y-11.1,camera.position.z+z+.2],i*6);}rainGeo.attributes.position.needsUpdate=true;
 post.uniforms.time.value=worldTime;post.uniforms.rain.value=weather;post.uniforms.boost.value=boosting?1:0;post.uniforms.damage.value=player.crash>0?1:0;
 renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(postScene,postCamera);drawFX(status==='paused'?0:dt,boosting);if(running)sound.update(player.speed,weather,player.slip,boosting);
 hudTimer+=dt;if(hudTimer>.08){hudTimer=0;publish();}}

 const toolLifecycle=new AbortController();
 type Tool={name:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean};execute:(input:unknown)=>unknown};
 const modelContext=(document as Document & {modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
 const summary=()=>({status,distanceMetres:Math.round(player.s),totalMetres:LENGTH,speedKmh:Math.round(player.speed*3.6),position:rank,timeSeconds:Math.round(elapsed),stylePoints:player.score});
 if(modelContext?.registerTool){
  const tool:Tool={name:'read_inkfall_race',description:'Read the current visible INKFALL race status, position, distance and score.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(typeof input!=='object'||input===null||Array.isArray(input)||Object.keys(input).length)throw Error('Expected an empty object');return summary();}};
  try{void Promise.resolve(modelContext.registerTool(tool,{signal:toolLifecycle.signal})).catch(()=>{});}catch{/* WebMCP is optional in this browser. */}
 }
 publish();frame=requestAnimationFrame(animate);
 return{start,pause,mute:v=>sound.mute(v),key:setKey,dispose(){disposed=true;toolLifecycle.abort();cancelAnimationFrame(frame);ro.disconnect();window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);sound.dispose();const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points||o instanceof T.LineSegments){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if('map'in m&&m.map instanceof T.Texture)textures.add(m.map);}}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();paperTexture.dispose();post.dispose();postScene.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose()});target.dispose();renderer.dispose();renderer.domElement.remove();fx.remove();}};
}
