var I=null,be=0,rt=!1;function qa(t){I=t}function Oa(t){let e=rt;rt=!0;try{return t()}finally{rt=e}}function yt(t,e,a){if(!I||t.ignored)return;let l={id:++be,kind:e,name:a};t.inspect=l,I.onCreate?.(l)}var P=null,U=null,G=0,lt=[],xt=!1,ge=()=>!1;function st(t,e,a,l){let r=l&&l.equals===!1?ge:l&&l.equals||Object.is;return{value:t,fn:e,state:0,sources:null,observers:null,equals:r,effect:a,init:!1,disposed:!1,queued:!1,owned:null,cleanups:null,parent:U,errorHandlers:null,inspect:null,ignored:rt||!!(U&&U.ignored)}}function Pt(t){U&&(U.owned||=[]).push(t)}function Bt(t){return t.fn&&!t.effect&&nt(t),P&&((P.sources||=new Set).add(t),(t.observers||=new Set).add(P)),t.value}function bt(t,e){if(t.equals(t.value,e))return t.value;if(t.value=e,t.inspect&&I?.onUpdate?.(t.inspect,e),t.observers)for(let a of t.observers)It(a,2);return G||Ht(),t.value}function It(t,e){if(t.state<e){let a=t.state===0;if(t.state=e,a){if(t.effect)qt(t);else if(t.observers)for(let l of t.observers)It(l,1)}}}function qt(t){t.queued||(t.queued=!0,lt.push(t))}function nt(t){if(t.state!==0){if(t.state===1&&t.sources){for(let e of t.sources)if(e.fn&&!e.effect&&nt(e),t.state===2)break}t.state===2&&ye(t),t.state=0}}function ye(t){Ot(t,!1);let e=P,a=U;P=t,U=t;let l,r=!1,s;try{l=t.fn()}catch(n){r=!0,s=n}finally{P=e,U=a}if(r){if(t.owned){for(let n of t.owned)it(n);t.owned=null}if(!ke(t,s))throw s;return}if(t.inspect&&I?.onRun?.(t.inspect),t.effect)typeof l=="function"&&(t.cleanups||=[]).push(l);else if((!t.init||!t.equals(t.value,l))&&(t.value=l,t.init=!0,t.inspect&&I?.onUpdate?.(t.inspect,l),t.observers))for(let n of t.observers)n.state<2&&(n.state=2)}function ke(t,e){let a=t;for(;a;){let l=a.errorHandlers;if(l&&l.length)return z(()=>{for(let r of l)r(e)}),!0;a=a.parent}return!1}function Ot(t,e){if(t.owned){for(let a of t.owned)it(a);t.owned=null}if(t.cleanups){for(let a of t.cleanups)a();t.cleanups=null}if(t.sources){for(let a of t.sources)a.observers&&a.observers.delete(t);t.sources=null}if(e&&(t.disposed=!0,t.observers)){for(let a of t.observers)a.sources&&a.sources.delete(t);t.observers=null}}function it(t){t.disposed||(t.inspect&&I?.onDispose?.(t.inspect),Ot(t,!0))}var we=1e6;function Ht(){if(xt||G)return;xt=!0;let t,e=!1;try{let a=0;for(;a<lt.length;a++){if(a>we)throw new Error("dxjs: potential infinite update loop");let l=lt[a];if(l.queued=!1,!l.disposed)try{nt(l)}catch(r){e||(e=!0,t=r)}}}finally{lt.length=0,xt=!1}if(e)throw t}function y(t,e){let a=st(t,null,!1,e);I&&(yt(a,"signal",e?.name),a.inspect&&I.onUpdate?.(a.inspect,t));let l=((...r)=>{if(r.length===0)return Bt(a);let s=r[0],n=typeof s=="function"?s(a.value):s;return bt(a,n)});return l.set=r=>bt(a,r),l.update=r=>bt(a,r(a.value)),l.peek=()=>a.value,l}function B(t,e){let a=st(void 0,t,!1,e);return a.state=2,Pt(a),I&&yt(a,"computed",e?.name),()=>Bt(a)}function j(t,e){let a=st(void 0,t,!0);return a.state=2,Pt(a),I&&yt(a,"effect",e),G?qt(a):nt(a),()=>it(a)}function Ha(t){if(G)return t();G++;try{return t()}finally{G--,Ht()}}function z(t){let e=P;P=null;try{return t()}finally{P=e}}function L(t){U&&(U.cleanups||=[]).push(t)}function _a(t){U&&(U.errorHandlers||=[]).push(t)}function W(t){let e=st(void 0,null,!1),a=P,l=U;P=null,U=e;try{return t(()=>it(e))}finally{P=a,U=l}}var gt=new Map;function _t(t){return{id:Symbol("dx-context"),defaultValue:t}}function kt(t,e,a){let l=gt.get(t.id);l||(l=[],gt.set(t.id,l)),l.push(e);try{return a()}finally{l.pop()}}function Wt(t){let e=gt.get(t.id);return e&&e.length?e[e.length-1]:t.defaultValue}var Ce={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Te=/[&<>"']/g;function Ga(t){return String(t).replace(Te,e=>Ce[e])}var Se=new Set(["href","src","action","formaction","xlink:href","poster","data","ping","background","cite","longdesc","usemap"]),De=/^(?:javascript|vbscript):/i,Me=/^data:(?:image|audio|video|font)\//i,Ae=/[\u0000-\u0020]+/g;function Vt(t){return Se.has(t.toLowerCase())}var Le=new Set(["innerhtml","outerhtml","srcdoc"]);function Ee(t){return Le.has(t.toLowerCase())}function Jt(t){let e=t.replace(Ae,"").toLowerCase();return De.test(e)||e.startsWith("data:")&&!Me.test(t.trim())?"":t}var wt="__dxm_attr__",Ct="dxm",Re=1,Ne=8;function i(t,...e){return{_dx:!0,strings:t,values:e}}function Fe(t){return!!t&&typeof t=="object"&&t._dx===!0}var Ue=Symbol.for("dxjs.Fragment");function Va(t,e){return{_dxel:!0,type:t,props:e??{}}}function je(t){return!!t&&typeof t=="object"&&t._dxel===!0}var Kt=new WeakMap;function ze(t){let e=[],a=!1,l="";for(let r=0;r<t.length;r++){let s=t[r];for(let n=0;n<s.length;n++){let o=s[n];l?o===l&&(l=""):a?o==='"'||o==="'"?l=o:o===">"&&(a=!1):o==="<"&&(a=!0)}r<t.length-1&&e.push(a?"attr":"child")}return e}function Pe(t){let e=Kt.get(t);if(e)return e;let a=ze(t),l="";for(let s=0;s<t.length;s++)l+=t[s],s<t.length-1&&(l+=a[s]==="child"?`<!--${Ct}-->`:wt);let r=document.createElement("template");return r.innerHTML=l,Kt.set(t,r),r}function V(t){return typeof t=="function"?t():t}function Be(t,e,a,l){if(e==="ref"){t.removeAttribute(e),typeof a=="function"&&a(t);return}let r=e[0];if(r==="@"){let s=e.slice(1);if(t.removeAttribute(e),typeof a=="function"){let n=a;t.addEventListener(s,n),l.push(()=>t.removeEventListener(s,n))}return}if(r==="."){let s=e.slice(1);if(t.removeAttribute(e),Ee(s))return;l.push(j(()=>{t[s]=V(a)}));return}if(r==="?"){let s=e.slice(1);t.removeAttribute(e),l.push(j(()=>{t.toggleAttribute(s,!!V(a))}));return}if(/^on/i.test(e)){t.removeAttribute(e);return}l.push(j(()=>{let s=V(a);if(s==null||s===!1)t.removeAttribute(e);else{let n=s===!0?"":String(s);t.setAttribute(e,Vt(e)?Jt(n):n)}}))}function ot(t){return t==null||t===!1||t===!0||t===""?{nodes:[],dispose:()=>{}}:Fe(t)?Xt(t):je(t)?_e(t):{nodes:[document.createTextNode(String(t))],dispose:()=>{}}}var Ie={nodes:[],dispose:()=>{}};function qe(t){return t.replace(/[A-Z]/g,e=>"-"+e.toLowerCase())}var Oe=new Set(["value","checked","selected","indeterminate"]);function He(t,e,a,l){if(e!=="key"){if(e==="ref"){typeof a=="function"&&a(t);return}if(e.length>2&&e[0]==="o"&&e[1]==="n"){let r=e[2],s=r===":"?e.slice(3):r>="A"&&r<="Z"?e.slice(2).toLowerCase():"";if(s){if(typeof a=="function"){let n=a;t.addEventListener(s,n),l.push(()=>t.removeEventListener(s,n))}return}return}if(e==="className"&&(e="class"),e==="style"&&a!==null&&typeof a=="object"&&typeof a!="function"){let r=t.style;for(let s in a)r.setProperty(qe(s),String(a[s]));return}if(Oe.has(e)){l.push(j(()=>{t[e]=V(a)}));return}l.push(j(()=>{let r=V(a);if(r==null||r===!1)t.removeAttribute(e);else{let s=r===!0?"":String(r);t.setAttribute(e,Vt(e)?Jt(s):s)}}))}}function Gt(t){let e=document.createDocumentFragment(),a=[],l=r=>{if(r==null||r===!1||r===!0||r==="")return;if(Array.isArray(r)){for(let n of r)l(n);return}if(typeof r=="function"||Yt(r)){let n=document.createComment(Ct);e.appendChild(n),Zt(n,r,a);return}let s=ot(r);for(let n of s.nodes)e.appendChild(n);a.push(s.dispose)};return l(t),{nodes:[...e.childNodes],dispose:()=>a.forEach(r=>r())}}function _e(t){let{type:e,props:a}=t;if(e===Ue)return Gt(a.children);if(typeof e=="function")return ot(e(a));if(typeof e!="string")return Ie;let l=document.createElement(e),r=[];for(let s in a)s!=="children"&&He(l,s,a[s],r);if("children"in a){let s=Gt(a.children);for(let n of s.nodes)l.appendChild(n);r.push(s.dispose)}return{nodes:[l],dispose:()=>r.forEach(s=>s())}}function D(t,e,a){return{_dxlist:!0,items:t,key:e,render:a}}function Yt(t){return!!t&&typeof t=="object"&&t._dxlist===!0}function Zt(t,e,a){let l=t.parentNode,r=document.createTextNode("");l.insertBefore(r,t),l.removeChild(t);let s=()=>r.parentNode??l,n=[],o=[],d=()=>{for(let c of o)c();o=[];for(let c of n)c.parentNode&&c.parentNode.removeChild(c);n=[]},p=c=>{let f=Array.isArray(c)?c:[c],m=s();for(let w of f){let S=ot(w);for(let v of S.nodes)m.insertBefore(v,r);n.push(...S.nodes),o.push(S.dispose)}};if(Yt(e)){let c=e,f=new Map,m=()=>{for(let[,S]of f){S.dispose();for(let v of S.nodes)v.parentNode&&v.parentNode.removeChild(v)}f.clear()},w=(S,v)=>W(x=>{try{let h=Xt(c.render(S,v));return{nodes:h.nodes,dispose:()=>{h.dispose(),x()}}}catch(h){throw x(),h}});a.push(j(()=>{let S=typeof c.items=="function"?c.items():c.items,v=new Set,x=[];S.forEach((u,g)=>{let C=c.key(u,g);v.add(C);let k=f.get(C);k||(k=w(u,g),f.set(C,k)),x.push(k)});for(let[u,g]of f)if(!v.has(u)){g.dispose();for(let C of g.nodes)C.parentNode&&C.parentNode.removeChild(C);f.delete(u)}let h=s();for(let u of x)for(let g of u.nodes)h.insertBefore(g,r)})),a.push(m),L(m);return}a.push(j(()=>{let c=V(e);d(),p(c)})),a.push(d)}function Qt(t,e,a,l){if(t.nodeType===Re){let r=t;for(let s of[...r.attributes])if(s.value===wt)Be(r,s.name,e[a.v++],l);else if(s.value.includes(wt))throw new Error("dxjs: an interpolation must be the entire attribute value")}for(let r of[...t.childNodes])r.nodeType===Ne&&r.data===Ct?Zt(r,e[a.v++],l):Qt(r,e,a,l)}function Xt(t){let e=Pe(t.strings).content.cloneNode(!0),a=[];return Qt(e,t.values,{v:0},a),{nodes:[...e.childNodes],dispose:()=>{for(let l of a)l()}}}function te(t,e){return W(a=>{let l=ot(t);for(let r of l.nodes)e.appendChild(r);return L(()=>{l.dispose();for(let r of l.nodes)r.parentNode&&r.parentNode.removeChild(r)}),a})}function ee(t){let e=t;if(typeof e.pending=="function"&&typeof e.data=="function"){let s=e.data,n=e.error,o=e.pending;return{data:()=>s(),error:()=>n(),pending:()=>o()}}let a=t,l=typeof a.loading=="function"?a.loading:typeof a.isLoading=="function"?a.isLoading:void 0,r=()=>a();return{data:r,error:()=>a.error(),pending:()=>(l?l():!1)&&r()===void 0}}function ae(t){return"Error: "+(t instanceof Error?t.message:String(t))}function We(t){return t==null||Array.isArray(t)&&t.length===0}function re(t,e){let a=ee(t),l=e.keepPrevious??!0,r=()=>{let s=a.error();if(s!==void 0)return e.error?e.error(s):ae(s);let n=a.pending(),o=a.data();return n&&(o===void 0||!l)?e.pending?e.pending():"":We(o)?e.empty?e.empty():"":e.then(o)};return i`${()=>r()}`}var Ya=re;function Za(t,e){let a=y(void 0),l=y(void 0),r=y(!0),s=typeof t=="function",n=0,o=()=>{let d=++n;z(()=>{r.set(!0),l.set(void 0)}),(s?t():t).then(p=>{d===n&&z(()=>{a.set(p),r.set(!1)})},p=>{d===n&&z(()=>{l.set(p),r.set(!1)})})};return s?j(()=>o()):o(),L(()=>{n++}),re({data:()=>a(),error:()=>l(),pending:()=>r()&&a()===void 0},e)}function Qa(t,e){let a=ee(t),l=()=>{let s=a.data();return Array.isArray(s)?s:[]},r=()=>{let s=a.error();if(s!==void 0)return e.error?e.error(s):ae(s);let n=a.data(),o=a.pending();return o&&n===void 0?e.pending?e.pending():"":!o&&(n===void 0||Array.isArray(n)&&n.length===0)&&e.empty?e.empty():""};return i`${D(l,e.key,e.render)}${()=>r()}`}function Xa(t,e){let a=t;return i`${D(a,e.key,e.render)}${()=>a().length===0&&e.empty?e.empty():""}`}function Ke(t){return t.replace(/-([a-z])/g,(e,a)=>a.toUpperCase())}function lr(t,e,a={}){let l=globalThis.customElements;if(!l||l.get(t))return;let r=a.attributes??[],s=a.shadow;class n extends HTMLElement{constructor(){super(),this.sigs=new Map,this.dispose=null;for(let d of r)this.sigs.set(d,y(null))}static get observedAttributes(){return r}connectedCallback(){for(let c of r)this.sigs.get(c).set(this.getAttribute(c));let d={};for(let[c,f]of this.sigs)d[Ke(c)]=()=>f();let p=s?this.attachShadow(typeof s=="object"?s:{mode:"open"}):this;this.dispose=St(e,p,d)}attributeChangedCallback(d,p,c){this.sigs.get(d)?.set(c)}disconnectedCallback(){this.dispose?.(),this.dispose=null}}l.define(t,n)}function Ge(t){try{return decodeURIComponent(t)}catch{return t}}var Tt=_t(null);function Ve(t){let e=[];for(let a of t.split("/"))a.startsWith(":")?e.push(a.slice(1)):a==="*"&&e.push("rest");return e}function Je(t,e){let a=t.replace(/\/+$/,""),l=e.replace(/^\/+/,"");return l?(a===""?"":a)+"/"+l:a===""?"/":a}function le(t,e,a){let l=[];for(let r of t){let s=Je(e,r.path),n=[...a,r];r.children&&r.children.length?l.push(...le(r.children,s,n)):l.push({chain:n,pattern:s,levelNames:n.map(o=>Ve(o.path))})}return l}function Ye(t){if(t==="/"||t==="")return{re:/^\/?$/,names:[]};let e=[],a="^";for(let l of t.split("/"))l!==""&&(a+="/",l.startsWith(":")?(e.push(l.slice(1)),a+="([^/]+)"):l==="*"?(e.push("rest"),a+="(.*)"):a+=l.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));return a+="/?$",{re:new RegExp(a),names:e}}function Ze(){let t=globalThis.location;return{pathname:t?.pathname??"/",search:t?.search??""}}function ir(t,e={}){let a=le(t,"",[]).map(f=>{let{re:m,names:w}=Ye(f.pattern);return{...f,re:m,names:w}}),l=y([]);function r(f,m,w,S){let v={};return f.names.forEach((x,h)=>{v[x]=Ge(m[h+1]??"")}),f.chain.map((x,h)=>{let u=y(void 0),g={path:w,params:v,query:S,data:()=>u()};if(x.loader){let R=x.loader(g);R&&typeof R.then=="function"?R.then(_=>u.set(_)).catch(()=>u.set(void 0)):u.set(R)}let C=f.levelNames[h]??[],k=x.path+"|"+C.map(R=>v[R]).join(",");return{route:x,ctx:g,key:k}})}let s=()=>{let{pathname:f,search:m}=Ze(),w=new URLSearchParams(m);for(let S of a){let v=S.re.exec(f);if(!v)continue;let x=r(S,v,f,w),h=!1;for(let u of x){let g=u.route.guard;if(!g)continue;let C=g(u.ctx);if(C===!1){h=!0;break}if(typeof C=="string"){n(C,{replace:!0});return}}if(h)break;l.set(x);return}e.fallback&&f!==e.fallback?n(e.fallback,{replace:!0}):l.set([])};function n(f,m={}){let w=globalThis.history;w&&w[m.replace?"replaceState":"pushState"](null,"",f),s()}let o=()=>s(),d=globalThis.addEventListener?globalThis:void 0;d&&d.addEventListener("popstate",o),s();function p(f,m){let w=null,S,v=0,x=j(()=>{let h=l()[m],u=h?h.key:null;if(u===S)return;S=u;let g=++v;if(w&&(w(),w=null),!h)return;let C={matches:()=>l(),depth:m+1},k=R=>{g===v&&(w=kt(Tt,C,()=>St(R,f,h.ctx)))};h.route.component?k(h.route.component):h.route.load&&h.route.load().then(R=>k(R.default))});L(()=>{x(),w&&w()})}function c(f){return W(m=>(p(f,0),m))}return{current:()=>{let f=l(),m=f[f.length-1];return m?{route:m.route,ctx:m.ctx}:null},matches:()=>l(),navigate:n,outlet:c,dispose(){d&&d.removeEventListener("popstate",o)}}}function or(){let t=Wt(Tt);return i`<dx-outlet
    ref=${e=>{if(!t)return;let a=null,l,r=0,s=j(()=>{let n=t.matches()[t.depth],o=n?n.key:null;if(o===l)return;l=o;let d=++r;if(a&&(a(),a=null),!n)return;let p={matches:t.matches,depth:t.depth+1},c=f=>{d===r&&(a=kt(Tt,p,()=>St(f,e,n.ctx)))};n.route.component?c(n.route.component):n.route.load&&n.route.load().then(f=>c(f.default))});L(()=>{s(),a&&a()})}}
  ></dx-outlet>`}var tt=null;function dr(t){return t}function se(t){if(tt)tt.push(t);else{let e=t();typeof e=="function"&&L(e)}}function St(t,e,a){return W(l=>{let r=[],s=tt;tt=r;let n;try{n=t(a)}finally{tt=s}let o=te(n,e);L(o);for(let d of r){let p=d();typeof p=="function"&&L(p)}return l})}var Qe=["xs","sm","md","lg","xl","xxl"],Xe=t=>typeof t=="number"?Qe[Math.min(6,Math.max(1,t))-1]??"md":t??"md",q=t=>{let e=Xe(t);return e==="md"?"":`dx-sz-${e}`},$=t=>typeof t=="function"?t():t,ta=0,H=t=>`${t}-${++ta}`,T=(...t)=>t.filter(Boolean).join(" ");function ea(t){let e=T("dx-btn",t.variant&&t.variant!=="default"&&`is-${t.variant}`,q(t.size),t.block&&"is-block",!t.label&&"is-icon");return i`<button
    class=${e}
    type=${t.type??"button"}
    aria-label=${t.ariaLabel??!1}
    aria-busy=${()=>$(t.loading??!1)?"true":!1}
    ?disabled=${()=>$(t.disabled??!1)||$(t.loading??!1)}
    @click=${a=>t.onClick?.(a)}
  >${()=>$(t.loading??!1)?i`<span class="dx-spinner dx-btn-spin" aria-hidden="true"></span>`:t.icon?i`<span class="dx-btn-ico" aria-hidden="true">${()=>$(t.icon)}</span>`:""}${()=>$(t.label??"")}</button>`}function hr(t){return i`<div class="dx-btn-group" role="group">${t}</div>`}function mr(t,e="mut"){return i`<span class=${`dx-badge is-${e}`}>${()=>$(t)}</span>`}function aa(t){return i`<input
    class=${T("dx-input",q(t.size))}
    id=${t.id??!1}
    type=${t.type??"text"}
    placeholder=${t.placeholder??!1}
    aria-label=${t.ariaLabel??!1}
    aria-describedby=${t.ariaDescribedby??!1}
    aria-invalid=${()=>$(t.invalid??!1)?"true":!1}
    .value=${()=>$(t.value??"")}
    ?disabled=${()=>$(t.disabled??!1)}
    @input=${e=>t.onInput?.(e.target.value,e)}
    @blur=${e=>t.onBlur?.(e)}
  />`}function $r(t){return i`<textarea
    class=${T("dx-input dx-textarea",q(t.size))}
    id=${t.id??!1}
    rows=${t.rows??3}
    placeholder=${t.placeholder??!1}
    aria-label=${t.ariaLabel??!1}
    aria-invalid=${()=>$(t.invalid??!1)?"true":!1}
    .value=${()=>$(t.value??"")}
    ?disabled=${()=>$(t.disabled??!1)}
    @input=${e=>t.onInput?.(e.target.value,e)}
    @blur=${e=>t.onBlur?.(e)}
  ></textarea>`}function vr(t){let e=t.id??H("dx-f"),a=H("dx-fh"),l=()=>!!$(t.error??!1)||$(t.invalid??!1),r=t.control?t.control({id:e,invalid:l,ariaDescribedby:a}):aa({...t,id:e,invalid:l,ariaDescribedby:a});return i`<div class="dx-field">
    <label class="dx-field-label" for=${e}>${t.label}${t.required?i`<span class="dx-req" aria-hidden="true">*</span>`:""}</label>
    ${r}
    ${()=>{let s=$(t.error??!1);return s?i`<p class="dx-field-msg is-error" id=${a} role="alert">${s}</p>`:t.hint?i`<p class="dx-field-msg" id=${a}>${t.hint}</p>`:""}}
  </div>`}function xr(t){return i`<select
    class=${T("dx-select",q(t.size))}
    id=${t.id??!1}
    aria-label=${t.ariaLabel??!1}
    .value=${()=>$(t.value??"")}
    ?disabled=${()=>$(t.disabled??!1)}
    @change=${e=>t.onChange?.(e.target.value)}
  >${t.placeholder?i`<option value="" disabled>${t.placeholder}</option>`:""}${D(()=>$(t.options),e=>e.value,e=>i`<option value=${e.value} ?disabled=${e.disabled??!1}>${e.label}</option>`)}</select>`}function br(t){let e=t.id??H("dx-sw");return i`<button
    class="dx-switch"
    role="switch"
    id=${e}
    type="button"
    aria-checked=${()=>$(t.checked)?"true":"false"}
    ?disabled=${()=>$(t.disabled??!1)}
    @click=${()=>t.onChange?.(!$(t.checked))}
  ><span class="dx-switch-track" aria-hidden="true"><span class="dx-switch-thumb"></span></span>${t.label?i`<span class="dx-switch-label">${t.label}</span>`:""}</button>`}function pt(t){let e=t.id??H("dx-cb");return i`<label class="dx-check" for=${e}>
    <input
      type="checkbox"
      id=${e}
      class="dx-check-input"
      .checked=${()=>$(t.checked)}
      ?disabled=${()=>$(t.disabled??!1)}
      @change=${a=>t.onChange?.(a.target.checked)}
    />
    <span class="dx-check-box" aria-hidden="true"></span>
    ${t.label?i`<span class="dx-check-label">${t.label}</span>`:""}
  </label>`}function gr(t){let e=t.name??H("dx-rg");return i`<div class="dx-radios" role="radiogroup" aria-label=${t.ariaLabel??!1}>${D(()=>$(t.options),a=>a.value,a=>{let l=H("dx-r");return i`<label class="dx-radio" for=${l}>
        <input
          type="radio"
          id=${l}
          name=${e}
          value=${a.value}
          class="dx-radio-input"
          .checked=${()=>$(t.value??"")===a.value}
          ?disabled=${a.disabled??!1}
          @change=${()=>t.onChange?.(a.value)}
        />
        <span class="dx-radio-dot" aria-hidden="true"></span><span class="dx-radio-label">${a.label}</span>
      </label>`})}</div>`}var jt=(t,e)=>t.value?t.value(e):e[t.key]??"",pe=t=>typeof t=="number"&&Number.isFinite(t),ra=/^[=+\-@\t\r]/,ne=t=>{let e=String(t);return ra.test(e)&&(e="'"+e),/[",\r\n]/.test(e)?`"${e.replace(/"/g,'""')}"`:e};function la(t,e){let a=e.map(r=>ne(r.label)).join(","),l=t.map(r=>e.map(s=>ne(jt(s,r))).join(",")).join(`\r
`);return l?`${a}\r
${l}`:a}var ct=t=>String(t).replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[e]);function sa(t,e){let a=e.map(r=>`<th>${ct(r.label)}</th>`).join(""),l=t.map(r=>`<tr>${e.map(s=>{let n=jt(s,r);return pe(n)?`<td style="mso-number-format:General">${ct(n)}</td>`:`<td>${ct(n)}</td>`}).join("")}</tr>`).join("");return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1"><thead><tr>${a}</tr></thead><tbody>${l}</tbody></table></body></html>`}var K=new TextEncoder;function na(t){let e="",a=t;do e=String.fromCharCode(65+a%26)+e,a=Math.floor(a/26)-1;while(a>=0);return e}function ia(t,e){let a=(s,n,o)=>{let d=`${na(s)}${n}`;return pe(o)?`<c r="${d}"><v>${o}</v></c>`:`<c r="${d}" t="inlineStr"><is><t xml:space="preserve">${ct(o)}</t></is></c>`},l=`<row r="1">${e.map((s,n)=>a(n,1,s.label)).join("")}</row>`,r=t.map((s,n)=>`<row r="${n+2}">${e.map((o,d)=>a(d,n+2,jt(o,s))).join("")}</row>`).join("");return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${l}${r}</sheetData></worksheet>`}var oa=(()=>{let t=new Uint32Array(256);for(let e=0;e<256;e++){let a=e;for(let l=0;l<8;l++)a=a&1?3988292384^a>>>1:a>>>1;t[e]=a>>>0}return t})();function da(t){let e=4294967295;for(let a=0;a<t.length;a++)e=oa[(e^t[a])&255]^e>>>8;return(e^4294967295)>>>0}function ca(t){let e=[],a=[],l=0,r=m=>new Uint8Array([m&255,m>>>8&255]),s=m=>new Uint8Array([m&255,m>>>8&255,m>>>16&255,m>>>24&255]),n=m=>{e.push(m),l+=m.length};for(let m of t){let w=K.encode(m.name),S=da(m.data);a.push({name:m.name,data:m.data,crc:S,offset:l}),n(s(67324752)),n(r(20)),n(r(0)),n(r(0)),n(r(0)),n(r(0)),n(s(S)),n(s(m.data.length)),n(s(m.data.length)),n(r(w.length)),n(r(0)),n(w),n(m.data)}let o=l;for(let m of a){let w=K.encode(m.name);n(s(33639248)),n(r(20)),n(r(20)),n(r(0)),n(r(0)),n(r(0)),n(r(0)),n(s(m.crc)),n(s(m.data.length)),n(s(m.data.length)),n(r(w.length)),n(r(0)),n(r(0)),n(r(0)),n(r(0)),n(s(0)),n(s(m.offset)),n(w)}let d=l-o;n(s(101010256)),n(r(0)),n(r(0)),n(r(a.length)),n(r(a.length)),n(s(d)),n(s(o)),n(r(0));let p=e.reduce((m,w)=>m+w.length,0),c=new Uint8Array(p),f=0;for(let m of e)c.set(m,f),f+=m.length;return c}var ua=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,pa=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,fa=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,ha=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;function ma(t,e){return ca([{name:"[Content_Types].xml",data:K.encode(ua)},{name:"_rels/.rels",data:K.encode(pa)},{name:"xl/workbook.xml",data:K.encode(fa)},{name:"xl/_rels/workbook.xml.rels",data:K.encode(ha)},{name:"xl/worksheets/sheet1.xml",data:K.encode(ia(t,e))}])}var Dt={csv:"text/csv;charset=utf-8",xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};function Mt(t,e,a){let l=globalThis.document,r=globalThis.URL;if(!l||!r)return;let s=new Blob([e],{type:a}),n=r.createObjectURL(s),o=l.createElement("a");o.href=n,o.download=t,l.body.appendChild(o),o.click(),o.remove(),r.revokeObjectURL(n)}function $a(t,e,a,l="export"){return a==="csv"?Mt(`${l}.csv`,la(t,e),Dt.csv):a==="xls"?Mt(`${l}.xls`,sa(t,e),Dt.xls):Mt(`${l}.xlsx`,ma(t,e),Dt.xlsx)}var va={csv:"CSV",xls:"Excel (.xls)",xlsx:"Excel (.xlsx)"};function fe(t){let e=y(!1),a=t.formats??["csv","xls","xlsx"],l=r=>{$a(t.rows(),t.columns,r,t.filename??"export"),e.set(!1)};return i`<div
    class="dx-export"
    @focusout=${r=>{let s=r.currentTarget,n=r.relatedTarget;(!n||!s.contains(n))&&e.set(!1)}}
  >
    <button class="dx-btn dx-export-btn" type="button" aria-haspopup="menu" aria-expanded=${()=>e()?"true":"false"} @click=${()=>e.set(!e())}>
      <span class="dx-export-ico" aria-hidden="true">⤓</span>${t.label??"Export"}<span class="dx-s2-caret" aria-hidden="true">▾</span>
    </button>
    <div class="dx-export-menu" role="menu" ?hidden=${()=>!e()}>${a.map(r=>i`<button class="dx-export-item" role="menuitem" type="button" @click=${()=>l(r)}>${va[r]}</button>`)}</div>
  </div>`}var At=(t,e)=>t.value?t.value(e):e[t.key]??"",ie=t=>{let e=t.align??(t.numeric?"right":null);return e?`dx-ta-${e}`:""};function wr(t){let e=t.columns.map(u=>({key:u.key,label:u.label,value:u.value})),a=t.exportable===!0?{}:t.exportable||null,l=y(null),r=y(!1),s=B(()=>{let u=l(),g=$(t.rows);if(!u)return g;let C=t.columns.find(R=>R.key===u);if(!C)return g;let k=r()?-1:1;return[...g].sort((R,_)=>{let Y=At(C,R),Z=At(C,_);return typeof Y=="number"&&typeof Z=="number"?(Y-Z)*k:String(Y).localeCompare(String(Z))*k})}),n=u=>{u.sortable&&(l()===u.key?r.set(!r()):(l.set(u.key),r.set(!1)))},o=y(new Set),d=u=>{o.set(u),t.onSelectionChange?.([...u])},p=(u,g)=>{let C=new Set(o());g?C.add(u):C.delete(u),d(C)},c=()=>$(t.rows).map(u=>t.rowKey(u)),f=()=>{let u=c();return u.length>0&&u.every(g=>o().has(g))},m=u=>{let g=new Set(o());for(let C of c())u?g.add(C):g.delete(C);d(g)},w=u=>{let g=T(u.sortable&&"is-sortable",u.numeric&&"dx-num",ie(u)),C=()=>l()===u.key?r()?"\u25BC":"\u25B2":"",k=()=>u.sortable?l()===u.key?r()?"descending":"ascending":"none":!1,R=_=>{u.sortable&&(_.key==="Enter"||_.key===" ")&&(_.preventDefault(),n(u))};return i`<th
      class=${g}
      aria-sort=${k}
      tabindex=${u.sortable?"0":!1}
      @click=${()=>n(u)}
      @keydown=${R}
    >${u.label}<span class="dx-arrow" aria-hidden="true">${C}</span></th>`},S=u=>{let g=t.rowKey(u),C=t.onRow?k=>{(k.key==="Enter"||k.key===" ")&&(k.preventDefault(),t.onRow(u))}:void 0;return i`<tr
      class=${()=>T(t.selectable&&o().has(g)&&"is-selected",t.onRow&&"is-click")}
      tabindex=${t.onRow?"0":!1}
      @click=${t.onRow?()=>t.onRow(u):void 0}
      @keydown=${C}
    >${t.selectable?i`<td class="dx-tbl-sel" @click=${k=>k.stopPropagation()}>${pt({checked:()=>o().has(g),onChange:k=>p(g,k)})}</td>`:""}${D(t.columns,k=>k.key,k=>i`<td class=${T(k.numeric&&"dx-num",ie(k))}>${k.render?k.render(u):String(At(k,u))}</td>`)}</tr>`},v=()=>t.columns.length+(t.selectable?1:0),x=()=>i`${Array.from({length:4},()=>i`<tr class="dx-tbl-skel" aria-hidden="true">${Array.from({length:v()},()=>i`<td><span class="dx-skel dx-skel-line"></span></td>`)}</tr>`)}`,h=()=>$(t.loading??!1);return i`<section class="dx-card">
    ${t.title||a||t.toolbar?i`<div class="dx-tbl-toolbar">
          ${t.title?i`<h2 class="dx-card-title">${t.title}</h2>`:""}
          <div class="dx-spacer"></div>
          ${t.toolbar??""}
          ${a?fe({rows:()=>s(),columns:e,filename:a.filename,formats:a.formats}):""}
        </div>`:""}
    <div class="dx-tbl-wrap">
      <table class=${T("dx-tbl",t.density==="compact"&&"is-compact",t.striped&&"is-striped",t.stickyHeader&&"is-sticky")} aria-label=${t.title??"Data"}>
        <thead><tr>${t.selectable?i`<th class="dx-tbl-sel">${pt({checked:()=>f(),onChange:u=>m(u)})}</th>`:""}${D(t.columns,u=>u.key,w)}</tr></thead>
        <tbody>${()=>h()?x():""}${D(()=>h()?[]:s(),u=>t.rowKey(u),S)}</tbody>
      </table>
    </div>
  </section>`}var xa=t=>typeof t=="function"?t():t;function ba(t,e,a,l,r=4){if(l===0||e<=0)return{start:0,end:0};let s=Math.floor(t/e),n=Math.ceil(a/e),o=Math.max(0,s-r),d=Math.min(l,s+n+r);return{start:o,end:d}}var ga=0;function Dr(t){let e=`dxv${ga++}`,a=y(0),l=t.overscan??4,r=()=>xa(t.rows),s=()=>ba(a(),t.rowHeight,t.height,r().length,l),n=()=>{let{start:o,end:d}=s(),p=r(),c=[];for(let f=o;f<d;f++)c.push({row:p[f],index:f});return c};return se(()=>{let o=document.querySelector(`[data-dxv="${e}"]`);if(!o)return;let d=o.querySelector(".dx-vlist-sizer"),p=o.querySelector(".dx-vlist-win");o.style.height=`${t.height}px`,p.style.setProperty("--dxv-h",`${t.rowHeight}px`);let c=()=>{a.set(o.scrollTop)};o.addEventListener("scroll",c,{passive:!0});let f=j(()=>{d.style.height=`${r().length*t.rowHeight}px`,p.style.transform=`translateY(${s().start*t.rowHeight}px)`});L(()=>{o.removeEventListener("scroll",c),f()})}),i`<div class="dx-vlist" data-dxv=${e}>
    <div class="dx-vlist-sizer"></div>
    <div class="dx-vlist-win">${D(()=>n(),o=>t.key(o.row,o.index),o=>i`<div class="dx-vlist-row">${t.render(o.row,o.index)}</div>`)}</div>
  </div>`}function ya(){return globalThis.document?.documentElement??null}function Lt(t){let e=ya();e&&(t==="system"?e.removeAttribute("data-theme"):e.setAttribute("data-theme",t))}function Ar(t="system"){let e=y(t);return Lt(t),{theme:()=>e(),setTheme(a){e.set(a),Lt(a)},toggle(){let a=e()==="dark"?"light":"dark";e.set(a),Lt(a)}}}function Er(t){return i`<div class=${`dx-alert is-${t.tone??"info"}`} role=${t.tone==="neg"?"alert":"status"}>
    ${t.icon?i`<span class="dx-alert-ico" aria-hidden="true">${t.icon}</span>`:""}
    <div class="dx-alert-body">
      ${t.title?i`<div class="dx-alert-title">${t.title}</div>`:""}
      ${t.body?i`<div class="dx-alert-text">${()=>$(t.body)}</div>`:""}
    </div>
    ${t.onDismiss?i`<button class="dx-alert-x" aria-label="Dismiss" @click=${()=>t.onDismiss()}>×</button>`:""}
  </div>`}function Rr(t){let e=t.title?H("dx-modal"):"",a=l=>{l.key==="Escape"&&t.onClose?.()};return i`<div
    class=${T("dx-modal-backdrop",t.size&&`is-${t.size}`)}
    ?hidden=${()=>!$(t.open)}
    @click=${l=>{l.target===l.currentTarget&&t.onClose?.()}}
    @keydown=${a}
  >
    <div class="dx-modal" role="dialog" aria-modal="true" aria-labelledby=${e||!1}>
      ${t.title?i`<div class="dx-modal-head"><h2 class="dx-modal-title" id=${e}>${t.title}</h2><button class="dx-modal-x" aria-label="Close" @click=${()=>t.onClose?.()}>×</button></div>`:""}
      <div class="dx-modal-body">${()=>$(t.body)}</div>
      ${t.footer?i`<div class="dx-modal-foot">${()=>$(t.footer)}</div>`:""}
    </div>
  </div>`}function Nr(t){let e=H("dx-tip");return i`<span class=${T("dx-tip-wrap",`is-${t.placement??"top"}`)} tabindex="0" aria-describedby=${e}>
    ${t.children}<span class="dx-tip" role="tooltip" id=${e}>${t.tip}</span>
  </span>`}function Fr(t={}){let e=t.kind??"line";if(e==="line"){let a=t.lines??3;return i`<div class="dx-skel-lines" aria-hidden="true">${Array.from({length:a},()=>i`<span class="dx-skel dx-skel-line"></span>`)}</div>`}return i`<span class=${`dx-skel dx-skel-${e}`} aria-hidden="true"></span>`}function Ur(t="Loading"){return i`<span class="dx-spinner" role="status" aria-label=${t}></span>`}function jr(t){let e=t.max??100;return i`<div class="dx-progress-row">
    <progress class=${T("dx-progress",t.tone&&`is-${t.tone}`)} max=${e} value=${()=>$(t.value)}></progress>
    ${t.showValue?i`<span class="dx-progress-val">${()=>Math.round($(t.value)/e*100)}%</span>`:""}
  </div>`}function zr(t){let e=()=>Math.max(0,Math.min(1,$(t.value)))*100;return i`<div class=${T("dx-meter",t.tone&&`is-${t.tone}`)} role="progressbar" aria-label=${t.label??!1}>
    <svg class="dx-meter-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
      <rect class="dx-meter-bg" x="0" y="0" width="100" height="6" rx="3"></rect>
      <rect class="dx-meter-fill" x="0" y="0" width=${()=>e()} height="6" rx="3"></rect>
    </svg>
  </div>`}function Pr(t){return i`<div class="dx-empty">
    ${t.icon?i`<div class="dx-empty-ico" aria-hidden="true">${t.icon}</div>`:""}
    <div class="dx-empty-title">${t.title}</div>
    ${t.description?i`<p class="dx-empty-desc">${t.description}</p>`:""}
    ${t.action?ea({label:t.action.label,variant:"primary",onClick:t.action.onClick}):""}
  </div>`}function Ir(t){let e=a=>i`<button
      class=${()=>T("dx-tab",$(t.active)===a.id&&"is-active")}
      role="tab"
      type="button"
      aria-selected=${()=>$(t.active)===a.id?"true":"false"}
      ?disabled=${a.disabled??!1}
      @click=${()=>t.onSelect?.(a.id)}
    >${a.label}${a.count!==void 0?i`<span class="dx-tab-count">${()=>$(a.count)}</span>`:""}</button>`;return i`<div class="dx-tabs" role="tablist" aria-label=${t.ariaLabel??!1}>${D(()=>$(t.tabs),a=>a.id,e)}</div>`}function qr(t){return i`<div class=${T("dx-seg",t.size==="md"&&"is-md")} role="tablist" aria-label=${t.ariaLabel??!1}>${D(()=>$(t.options),e=>e.value,e=>i`<button
        class=${()=>T("dx-seg-item",$(t.value)===e.value&&"is-active")}
        role="tab"
        type="button"
        aria-selected=${()=>$(t.value)===e.value?"true":"false"}
        @click=${()=>t.onChange?.(e.value)}
      >${e.label}</button>`)}</div>`}function Or(t){let e=t.length-1;return i`<nav class="dx-crumbs" aria-label="Breadcrumb"><ol>${t.map((a,l)=>i`<li>${l===e||!a.onClick?i`<span class="dx-crumb is-current" aria-current=${l===e?"page":!1}>${a.label}</span>`:i`<button class="dx-crumb dx-link-btn" @click=${()=>a.onClick()}>${a.label}</button>`}${l<e?i`<span class="dx-crumb-sep" aria-hidden="true">/</span>`:""}</li>`)}</ol></nav>`}function Hr(t){let e=l=>i`<button
      class=${()=>T("dx-pnav-item",$(t.active)===l.id&&"is-active")}
      type="button"
      aria-current=${()=>$(t.active)===l.id?"page":!1}
      @click=${()=>t.onSelect?.(l.id)}
    >
      ${l.icon?i`<span class="dx-pnav-ico" aria-hidden="true">${l.icon}</span>`:i`<span class="dx-dot" aria-hidden="true"></span>`}
      <span class="dx-pnav-label">${l.label}</span>
      ${l.badge!==void 0?i`<span class="dx-pnav-badge">${()=>$(l.badge)}</span>`:""}
    </button>`,a=l=>i`<div class="dx-pnav-group">${l.label?i`<div class="dx-pnav-grouplabel">${l.label}</div>`:""}${l.items.map(e)}</div>`;return i`<nav class="dx-pnav" aria-label=${t.ariaLabel??"Navigation"}>${()=>$(t.groups).map(a)}</nav>`}function _r(t){let e=T("dx-avatar2",t.size&&t.size!=="md"&&`is-${t.size}`);return t.src?i`<img class=${e} src=${t.src} alt=${t.name??""} />`:i`<span class=${e} role="img" aria-label=${t.name??!1}>${t.initials??"?"}</span>`}function Wr(t){return t?i`<div class="dx-divider has-label" role="separator"><span>${t}</span></div>`:i`<hr class="dx-divider" />`}function Vr(t){let e=y(!1),a=y(""),l=()=>$(t.options),r=()=>{let c=$(t.value??(t.multiple?[]:""));return Array.isArray(c)?c:c?[c]:[]},s=c=>r().includes(c),n=()=>{let c=a().trim().toLowerCase();return c?l().filter(f=>f.label.toLowerCase().includes(c)):l()},o=c=>l().find(f=>f.value===c)?.label??c,d=c=>{if(t.multiple){let f=s(c)?r().filter(m=>m!==c):[...r(),c];t.onChange?.(f)}else t.onChange?.(c),e.set(!1),a.set("")},p=()=>{let c=r();return c.length===0?i`<span class="dx-s2-ph">${t.placeholder??"Select\u2026"}</span>`:t.multiple?i`<span class="dx-s2-chips">${c.map(f=>i`<span class="dx-s2-chip">${o(f)}<button class="dx-s2-chipx" aria-label=${`Remove ${o(f)}`} @click=${m=>{m.stopPropagation(),d(f)}}>×</button></span>`)}</span>`:o(c[0])};return i`<div
    class=${T("dx-s2",q(t.size),t.multiple&&"is-multi")}
    @focusout=${c=>{let f=c.currentTarget,m=c.relatedTarget;(!m||!f.contains(m))&&e.set(!1)}}
  >
    <button
      class="dx-s2-face"
      type="button"
      aria-haspopup="listbox"
      aria-expanded=${()=>e()?"true":"false"}
      aria-label=${t.ariaLabel??!1}
      @click=${()=>e.set(!e())}
    >${()=>p()}<span class="dx-s2-caret" aria-hidden="true">▾</span></button>
    <div class="dx-s2-pop" role="listbox" ?hidden=${()=>!e()}>
      <input
        class="dx-s2-search"
        type="search"
        placeholder=${t.searchPlaceholder??"Filter\u2026"}
        aria-label="Filter options"
        .value=${()=>a()}
        @input=${c=>a.set(c.target.value)}
      />
      <div class="dx-s2-list">${D(()=>n(),c=>c.value,c=>i`<button
            class=${()=>T("dx-s2-opt",s(c.value)&&"is-selected")}
            role="option"
            type="button"
            aria-selected=${()=>s(c.value)?"true":"false"}
            @click=${()=>d(c.value)}
          ><span class="dx-s2-check" aria-hidden="true">✓</span>${c.label}</button>`)}</div>
      ${()=>n().length===0?i`<div class="dx-s2-empty">No matches</div>`:""}
    </div>
  </div>`}var ka=["January","February","March","April","May","June","July","August","September","October","November","December"],wa=["Su","Mo","Tu","We","Th","Fr","Sa"],ft=t=>String(t).padStart(2,"0"),Ca=(t,e,a)=>`${t}-${ft(e+1)}-${ft(a)}`;function Jr(t){let e=t.monthNames??ka,a=t.weekdayNames??wa,l=t.weekStart??0,r=a.slice(l).concat(a.slice(0,l)),s=y(!1),n=new Date,o=()=>{let x=$(t.value??""),h=/^(\d{4})-(\d{2})-(\d{2})$/.exec(x);return h?{y:+h[1],m:+h[2]-1,d:+h[3]}:null},d=o(),p=y(d?.y??n.getFullYear()),c=y(d?.m??n.getMonth()),f=x=>{let h=c()+x,u=p();h<0?(h=11,u--):h>11&&(h=0,u++),c.set(h),p.set(u)},m=()=>{let x=p(),h=c(),u=(new Date(x,h,1).getDay()-l+7)%7,g=new Date(x,h+1,0).getDate(),C=[];for(let k=0;k<u;k++)C.push(null);for(let k=1;k<=g;k++)C.push(k);return C},w=x=>{let h=o();return!!h&&h.y===p()&&h.m===c()&&h.d===x},S=x=>n.getFullYear()===p()&&n.getMonth()===c()&&n.getDate()===x,v=()=>$(t.value??"")||(t.placeholder??"Pick a date");return i`<div
    class=${T("dx-dp",q(t.size))}
    @focusout=${x=>{let h=x.currentTarget,u=x.relatedTarget;(!u||!h.contains(u))&&s.set(!1)}}
  >
    <button
      class=${()=>T("dx-dp-face",!$(t.value??"")&&"is-empty")}
      type="button"
      aria-haspopup="dialog"
      aria-expanded=${()=>s()?"true":"false"}
      aria-label=${t.ariaLabel??!1}
      @click=${()=>s.set(!s())}
    ><span class="dx-dp-ico" aria-hidden="true">📅</span>${()=>v()}</button>
    <div class="dx-dp-pop" role="dialog" ?hidden=${()=>!s()}>
      <div class="dx-dp-head">
        <button class="dx-btn is-icon" type="button" aria-label="Previous month" @click=${()=>f(-1)}>‹</button>
        <span class="dx-dp-title">${()=>`${e[c()]} ${p()}`}</span>
        <button class="dx-btn is-icon" type="button" aria-label="Next month" @click=${()=>f(1)}>›</button>
      </div>
      <div class="dx-dp-grid dx-dp-dow">${r.map(x=>i`<span class="dx-dp-wd">${x}</span>`)}</div>
      <div class="dx-dp-grid">${()=>m().map(x=>x===null?i`<span class="dx-dp-cell is-empty"></span>`:i`<button
                class=${T("dx-dp-cell",w(x)&&"is-selected",S(x)&&"is-today")}
                type="button"
                aria-pressed=${w(x)?"true":"false"}
                @click=${()=>{t.onChange?.(Ca(p(),c(),x)),s.set(!1)}}
              >${x}</button>`)}</div>
    </div>
  </div>`}function Yr(t={}){let e=t.seconds??60,a=y(t.mode==="stopwatch"?0:e),l=y(!1),r,s=()=>{l.set(!1),r!==void 0&&clearInterval(r),r=void 0},n=()=>{t.mode==="stopwatch"?a.update(c=>c+1):(a.update(c=>Math.max(0,c-1)),a()<=0&&(s(),t.onComplete?.()))},o=()=>{l()||(t.mode!=="stopwatch"&&a()<=0&&a.set(e),l.set(!0),r=setInterval(n,1e3))},d=()=>{s(),a.set(t.mode==="stopwatch"?0:e)};t.running&&o(),L(s);let p=()=>{let c=a();return`${ft(Math.floor(c/60))}:${ft(c%60)}`};return i`<div class="dx-timer">
    <span class=${()=>T("dx-timer-face",l()&&"is-running",t.mode!=="stopwatch"&&a()<=0&&"is-done")} role="timer" aria-live="off">${()=>p()}</span>
    ${t.controls===!1?"":i`<div class="dx-timer-ctl">
          <button class="dx-btn is-icon" type="button" aria-label="Start" @click=${o}>▶</button>
          <button class="dx-btn is-icon" type="button" aria-label="Pause" @click=${s}>⏸</button>
          <button class="dx-btn is-icon" type="button" aria-label="Reset" @click=${d}>↺</button>
        </div>`}
  </div>`}function Ta(t){let e=t.width??100,a=t.height??28,l=1.5,r=()=>{let d=$(t.data);if(d.length===0)return[];let p=Math.min(...d),c=Math.max(...d)-p||1,f=d.length>1?(e-l*2)/(d.length-1):0;return d.map((m,w)=>[l+w*f,a-l-(m-p)/c*(a-l*2)])},s=()=>r().map(([d,p])=>`${d.toFixed(1)},${p.toFixed(1)}`).join(" "),n=()=>{let d=r();if(d.length===0)return"";let p=d[0],c=d[d.length-1];return`${p[0].toFixed(1)},${a} ${s()} ${c[0].toFixed(1)},${a}`},o=()=>{let d=r();return d.length?d[d.length-1]:[0,0]};return i`<svg
    class=${T("dx-spark",t.tone&&`is-${t.tone}`)}
    viewBox=${`0 0 ${e} ${a}`}
    preserveAspectRatio="none"
    role="img"
    aria-label=${t.ariaLabel??!1}
  >${t.fill?i`<polyline class="dx-spark-fill" points=${()=>n()}></polyline>`:""}<polyline
      class="dx-spark-line"
      points=${()=>s()}
    ></polyline>${t.dot?i`<circle class="dx-spark-dot" r="2" cx=${()=>o()[0].toFixed(1)} cy=${()=>o()[1].toFixed(1)}></circle>`:""}</svg>`}var M=t=>t.toISOString().slice(0,10),E=(t,e,a)=>new Date(Date.UTC(t,e-1,a));function he(t){let e=t%19,a=Math.floor(t/100),l=t%100,r=Math.floor(a/4),s=a%4,n=Math.floor((a+8)/25),o=Math.floor((a-n+1)/3),d=(19*e+a-r-o+15)%30,p=Math.floor(l/4),c=l%4,f=(32+2*s+2*p-d-c)%7,m=Math.floor((e+11*d+22*f)/451),w=Math.floor((d+f-7*m+114)/31),S=(d+f-7*m+114)%31+1;return E(t,w,S)}var J=(t,e)=>new Date(he(t).getTime()+e*864e5);function Qr(t,e,a,l){let r=E(t,e,1),s=(a-r.getUTCDay()+7)%7;return E(t,e,1+s+(l-1)*7)}var ut={"pt-AO":t=>[{date:M(E(t,1,1)),name:"Ano Novo",type:"public"},{date:M(E(t,2,4)),name:"Dia do In\xEDcio da Luta Armada",type:"public"},{date:M(J(t,-47)),name:"Ter\xE7a-feira de Carnaval",type:"public"},{date:M(E(t,3,8)),name:"Dia Internacional da Mulher",type:"public"},{date:M(E(t,3,23)),name:"Dia da Liberta\xE7\xE3o da \xC1frica Austral",type:"public"},{date:M(J(t,-2)),name:"Sexta-feira Santa",type:"public"},{date:M(E(t,4,4)),name:"Dia da Paz e Reconcilia\xE7\xE3o Nacional",type:"public"},{date:M(E(t,5,1)),name:"Dia do Trabalhador",type:"public"},{date:M(E(t,9,17)),name:"Dia do Fundador da Na\xE7\xE3o e do Her\xF3i Nacional",type:"public"},{date:M(E(t,11,2)),name:"Dia dos Finados",type:"public"},{date:M(E(t,11,11)),name:"Dia da Independ\xEAncia Nacional",type:"public"},{date:M(E(t,12,25)),name:"Dia de Natal e da Fam\xEDlia",type:"public"}],en:t=>[{date:M(E(t,1,1)),name:"New Year's Day",type:"public"},{date:M(J(t,-2)),name:"Good Friday",type:"public"},{date:M(J(t,1)),name:"Easter Monday",type:"public"},{date:M(E(t,5,1)),name:"Labour Day",type:"public"},{date:M(E(t,12,25)),name:"Christmas Day",type:"public"},{date:M(E(t,12,26)),name:"Boxing Day",type:"public"}],"pt-PT":t=>[{date:M(E(t,1,1)),name:"Ano Novo",type:"public"},{date:M(J(t,-47)),name:"Carnaval",type:"observance"},{date:M(J(t,-2)),name:"Sexta-feira Santa",type:"public"},{date:M(he(t)),name:"P\xE1scoa",type:"public"},{date:M(E(t,4,25)),name:"Dia da Liberdade",type:"public"},{date:M(E(t,5,1)),name:"Dia do Trabalhador",type:"public"},{date:M(E(t,6,10)),name:"Dia de Portugal",type:"public"},{date:M(E(t,12,25)),name:"Natal",type:"public"}]};function Xr(t,e){ut[t]=e}function me(t,e){let a=t.split("-")[0],l=ut[t]??ut[a]??ut.en;return l?l(e):[]}function tl(t,e){let a=new Map;for(let l of e)for(let r of me(t,l))a.has(r.date)||a.set(r.date,r);return a}var Ut=t=>String(t).padStart(2,"0"),Et=(t,e,a)=>`${t}-${Ut(e+1)}-${Ut(a)}`,Sa=(t,e,a)=>new Date(Date.UTC(t,e,a)).getUTCDay(),Da=(t,e)=>new Date(Date.UTC(t,e+1,0)).getUTCDate();function Ma(t,e){let a=new Intl.DateTimeFormat(t,{weekday:"short",timeZone:"UTC"}),l=Array.from({length:7},(r,s)=>a.format(new Date(Date.UTC(1970,0,4+s))));return l.slice(e).concat(l.slice(0,e))}function rl(t){let e=t.locale??"pt-AO",a=t.weekStart??0,l=new Date,r=Et(l.getUTCFullYear(),l.getUTCMonth(),l.getUTCDate()),s=()=>{let h=$(t.value??""),u=/^(\d{4})-(\d{2})/.exec(h);return u?[+u[1],+u[2]-1]:[l.getUTCFullYear(),l.getUTCMonth()]},[n,o]=s(),d=y(n),p=y(o),c=h=>{let u=p()+h,g=d();u<0?(u=11,g--):u>11&&(u=0,g++),p.set(u),d.set(g),t.onMonthChange?.(`${g}-${Ut(u+1)}`)},f=()=>{if(!t.holidays)return new Map;let h=typeof t.holidays=="function"?t.holidays(d()):me(e,d()),u=new Map;for(let g of h)u.set(g.date,g);return u},m=()=>{let h=new Map;for(let u of $(t.events??[]))(h.get(u.date)??h.set(u.date,[]).get(u.date)).push(u);return h},w=new Intl.DateTimeFormat(e,{month:"long",year:"numeric",timeZone:"UTC"}),S=Ma(e,a),v=()=>{let h=d(),u=p(),g=(Sa(h,u,1)-a+7)%7,C=[];for(let k=0;k<g;k++)C.push(null);for(let k=1;k<=Da(h,u);k++)C.push(k);return C},x=h=>{if(h===null)return i`<div class="dx-cal-cell is-empty"></div>`;let u=Et(d(),p(),h),g=f().get(u),C=m().get(u)??[];return i`<button
      class=${()=>T("dx-cal-cell",$(t.value??"")===u&&"is-selected",u===r&&"is-today",g&&"is-holiday")}
      type="button"
      aria-current=${u===r?"date":!1}
      aria-pressed=${()=>$(t.value??"")===u?"true":"false"}
      title=${g?g.name:!1}
      @click=${()=>t.onSelect?.(u)}
    >
      <span class="dx-cal-num">${String(h)}</span>
      ${g?i`<span class="dx-cal-holi" aria-hidden="true"></span>`:""}
      ${C.length?i`<span class="dx-cal-evs" aria-hidden="true">${C.slice(0,3).map(k=>i`<span class=${T("dx-cal-ev",k.tone&&`is-${k.tone}`)}></span>`)}</span>`:""}
    </button>`};return i`<div class=${T("dx-cal",q(t.size))}>
    <div class="dx-cal-head">
      <button class="dx-btn is-icon" type="button" aria-label="Previous month" @click=${()=>c(-1)}>‹</button>
      <span class="dx-cal-title">${()=>w.format(new Date(Date.UTC(d(),p(),1)))}</span>
      <button class="dx-btn is-icon" type="button" aria-label="Next month" @click=${()=>c(1)}>›</button>
    </div>
    <div class="dx-cal-grid dx-cal-dow">${S.map(h=>i`<span class="dx-cal-wd">${h}</span>`)}</div>
    <div class="dx-cal-grid">${D(()=>v(),(h,u)=>h===null?`e${u}`:Et(d(),p(),h),x)}</div>
  </div>`}var Aa=t=>t==="pos"?"\u25B2":t==="neg"?"\u25BC":"";function La(t){let e=t.tone??"mut",a=T("dx-metric",q(t.size),t.onClick&&"is-clickable"),l=i`<div class="dx-metric-main">
      <div class="dx-metric-label">${t.label}</div>
      <div class="dx-metric-value">${()=>$(t.value)}</div>
      ${t.delta?i`<div class=${`dx-metric-delta is-${e}`}><span class="dx-metric-arrow" aria-hidden="true">${Aa(t.tone)}</span>${()=>$(t.delta)}</div>`:""}
      ${t.hint?i`<div class="dx-metric-hint">${t.hint}</div>`:""}
    </div>${t.trend?i`<div class="dx-metric-trend">${Ta({data:t.trend,tone:t.tone,fill:!0})}</div>`:""}`,r=i`${t.icon?i`<div class="dx-metric-icon" aria-hidden="true">${t.icon}</div>`:""}${l}`;return t.onClick?i`<button type="button" class=${a} @click=${t.onClick}>${r}</button>`:i`<div class=${a}>${r}</div>`}function sl(t){return i`<div class="dx-metrics">${D(t,e=>e.label,La)}</div>`}function ol(t){let e=y(!1),a=()=>T("dx-img",q(t.size),t.rounded&&"is-rounded",t.fit==="contain"&&"is-contain",t.ratio&&"has-ratio",e()&&"is-broken");return i`<figure class=${()=>a()} ref=${l=>{t.ratio&&l.style.setProperty("--dx-img-ratio",t.ratio)}}>
    <img
      class="dx-img-el"
      src=${t.src}
      alt=${t.alt}
      loading=${t.loading??"lazy"}
      decoding="async"
      @error=${()=>e.set(!0)}
    />
    <span class="dx-img-ph" aria-hidden="true"></span>
    ${t.caption?i`<figcaption class="dx-img-cap">${t.caption}</figcaption>`:""}
  </figure>`}function dl(t){let e=T("dx-video",t.ratio&&"has-ratio");return i`<figure class=${e} ref=${a=>{t.ratio&&a.style.setProperty("--dx-img-ratio",t.ratio)}}>
    <video
      class="dx-video-el"
      src=${t.src}
      poster=${t.poster??!1}
      ?controls=${()=>t.controls??!0}
      ?autoplay=${()=>t.autoplay??!1}
      ?muted=${()=>t.muted??!1}
      ?loop=${()=>t.loop??!1}
    ></video>
    ${t.caption?i`<figcaption class="dx-video-cap">${t.caption}</figcaption>`:""}
  </figure>`}function cl(t){let e=y(0),a=y(!1),l=()=>$(t.slides).length,r=d=>{let p=l();p>0&&e.set((d%p+p)%p)},s=()=>r(e()+1),n=()=>r(e()-1);if(t.autoplayMs&&t.autoplayMs>0){let d=setInterval(()=>{a()||s()},t.autoplayMs);L(()=>clearInterval(d))}let o=d=>{d.key==="ArrowRight"?(s(),d.preventDefault()):d.key==="ArrowLeft"&&(n(),d.preventDefault())};return i`<div
    class="dx-carousel"
    role="region"
    aria-roledescription="carousel"
    aria-label=${t.ariaLabel??"Carousel"}
    tabindex="0"
    @keydown=${o}
    @pointerenter=${()=>a.set(!0)}
    @pointerleave=${()=>a.set(!1)}
  >
    <div class="dx-carousel-track">${D(()=>$(t.slides),(d,p)=>p,(d,p)=>i`<div
          class="dx-carousel-slide"
          role="group"
          aria-roledescription="slide"
          ?hidden=${()=>e()!==p}
        >${d}</div>`)}</div>
    ${t.showArrows===!1?"":i`<button class="dx-carousel-arrow is-prev" type="button" aria-label="Previous slide" @click=${n}>‹</button>
          <button class="dx-carousel-arrow is-next" type="button" aria-label="Next slide" @click=${s}>›</button>`}
    ${t.showDots===!1?"":i`<div class="dx-carousel-dots" role="tablist">${D(()=>$(t.slides),(d,p)=>p,(d,p)=>i`<button
              class=${()=>T("dx-carousel-dot",e()===p&&"is-active")}
              type="button"
              role="tab"
              aria-label=${`Slide ${p+1}`}
              aria-selected=${()=>e()===p?"true":"false"}
              @click=${()=>r(p)}
            ></button>`)}</div>`}
  </div>`}var Rt=360,Nt=180;function Ft(t,e){return[t+180,90-e]}function pl(t){let e=t.width??360,a=t.height??180,l=t.graticule??!0,r=[];for(let n=-180;n<=180;n+=30)r.push(n);let s=[];for(let n=-90;n<=90;n+=30)s.push(n);return i`<svg
    class="dx-map"
    viewBox=${`0 0 ${Rt} ${Nt}`}
    width=${e}
    height=${a}
    role="img"
    aria-label=${t.ariaLabel??!1}
  ><rect class="dx-map-ocean" x="0" y="0" width=${Rt} height=${Nt}></rect>${l?i`<g class="dx-map-grid" aria-hidden="true">${r.map(n=>{let o=Ft(n,0)[0];return i`<line class="dx-map-line" x1=${o} y1="0" x2=${o} y2=${Nt}></line>`})}${s.map(n=>{let o=Ft(0,n)[1];return i`<line class="dx-map-line" x1="0" y1=${o} x2=${Rt} y2=${o}></line>`})}</g>`:""}<g class="dx-map-markers">${D(()=>$(t.markers??[]),(n,o)=>n.label??o,n=>{let[o,d]=Ft(n.lon,n.lat);return i`<circle
        class=${T("dx-map-pin",n.tone&&`is-${n.tone}`)}
        r="3"
        cx=${o.toFixed(2)}
        cy=${d.toFixed(2)}
      >${n.label?i`<title>${n.label}</title>`:""}</circle>`})}</g></svg>`}var oe="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";function Ea(t,e){return t>=e?"full":t>=e-.5?"half":"empty"}function hl(t){let e=t.max??5,a=t.allowHalf??!1,l=a?.5:1,r=typeof t.onChange=="function",s=Array.from({length:e},(c,f)=>f+1),n=c=>{let f=Math.max(0,Math.min(e,c));t.onChange?.(f)},o=c=>()=>T("dx-star",`is-${Ea($(t.value),c)}`);if(!r){let c=t.ariaLabel??`${$(t.value)} of ${e} stars`;return i`<span
      class=${T("dx-rating is-readonly",q(t.size))}
      role="img"
      aria-label=${c}
    >${s.map(f=>i`<span class=${o(f)} aria-hidden="true"><svg class="dx-star-svg" viewBox="0 0 24 24"><path d=${oe}></path></svg></span>`)}</span>`}let d=c=>{let f=$(t.value);c.key==="ArrowRight"||c.key==="ArrowUp"?(c.preventDefault(),n(f+l)):(c.key==="ArrowLeft"||c.key==="ArrowDown")&&(c.preventDefault(),n(f-l))},p=H("dx-rate");return i`<span
    class=${T("dx-rating",q(t.size))}
    role="radiogroup"
    aria-label=${t.ariaLabel??!1}
    @keydown=${d}
  >${s.map(c=>i`<button
      class=${o(c)}
      type="button"
      role="radio"
      name=${p}
      aria-label=${`${c} ${c===1?"star":"stars"}`}
      aria-checked=${()=>$(t.value)>=c?"true":"false"}
      tabindex=${()=>Math.ceil($(t.value)||1)===c?"0":"-1"}
      @click=${f=>{let m=f.currentTarget.getBoundingClientRect(),w=a&&m.width>0&&f.clientX-m.left<m.width/2;n(w?c-.5:c)}}
    ><svg class="dx-star-svg" viewBox="0 0 24 24" aria-hidden="true"><path d=${oe}></path></svg></button>`)}</span>`}var $e=864e5,Ra=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],O=t=>{let[e,a,l]=t.split("-").map(Number);return Math.round(Date.UTC(e??1970,(a??1)-1,l??1)/$e)},Na=t=>{let e=new Date(Math.round(t)*$e);return`${Ra[e.getUTCMonth()]} ${e.getUTCDate()}`};function Fa(t,e,a,l){let r=O(t),s=O(e)-r||1,n=O(a),o=O(l),d=(n-r)/s*100,p=(o-n)/s*100;return{x:Math.max(0,d),width:Math.max(0,p)}}var et=16;function Ua(t,e,a){if(e&&a)return[e,a];if(t.length===0)return[e??"1970-01-01",a??"1970-01-02"];let l=t[0].start,r=t[0].end;for(let s of t)O(s.start)<O(l)&&(l=s.start),O(s.end)>O(r)&&(r=s.end);return[e??l,a??r]}function de(t,e){let a=O(t),l=O(e)-a||1,r=Math.min(l,10),s=[];for(let n=0;n<=r;n++)s.push({pos:n/r*100,label:Na(a+l*n/r)});return s}function $l(t){let e=()=>Ua($(t.tasks),t.start,t.end),a=s=>{let[n,o]=e(),d=Fa(n,o,s.start,s.end),p=s.progress!=null?Math.max(0,Math.min(100,s.progress)):null;return i`<div class="dx-gantt-row" role="row">
      <div class="dx-gantt-name" role="rowheader" title=${s.label}>${s.label}</div>
      <div class="dx-gantt-cell" role="gridcell">
        <svg class="dx-gantt-track" viewBox=${`0 0 100 ${et}`} preserveAspectRatio="none" role="img" aria-label=${`${s.label}: ${s.start} to ${s.end}`}>
          <rect class=${T("dx-gantt-bar",s.tone&&`is-${s.tone}`)} x=${d.x} y="3" width=${d.width} height=${et-6} rx="2"></rect>
          ${p!=null?i`<rect class="dx-gantt-prog" x=${d.x} y="3" width=${d.width*p/100} height=${et-6} rx="2"></rect>`:""}
        </svg>
      </div>
    </div>`},l=()=>{let s=de(...e());return i`<svg class="dx-gantt-axis" viewBox=${`0 0 100 ${et}`} preserveAspectRatio="none" aria-hidden="true">${s.map(n=>i`<line class="dx-gantt-tick" x1=${n.pos} y1="0" x2=${n.pos} y2=${et}></line>`)}</svg>`},r=()=>{let s=de(...e());return i`<div class="dx-gantt-labels">${s.map(n=>i`<span class="dx-gantt-lbl">${n.label}</span>`)}</div>`};return i`<div class="dx-gantt" role="grid" aria-label=${t.ariaLabel??"Timeline"}>
    <div class="dx-gantt-head" role="row">
      <div class="dx-gantt-name dx-gantt-corner" role="columnheader"></div>
      <div class="dx-gantt-cell" role="columnheader">${()=>l()}${()=>r()}</div>
    </div>
    ${D(()=>$(t.tasks),s=>s.id,a)}
  </div>`}var ce=t=>{let[e,a]=t.split(":").map(Number);return(e??0)*60+(a??0)};function ja(t,e,a,l){let r=(e-t)*60||1,s=t*60,n=ce(a)-s,o=ce(l)-s;return{top:n/r*100,height:(o-n)/r*100}}var za=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],Pa=t=>t<10?`0${t}`:`${t}`;function xl(t){let e=t.startHour??7,a=t.endHour??19,l=t.dayLabels??za,r=t.weekStart===1?[1,2,3,4,5,6,0]:[0,1,2,3,4,5,6],s=[];for(let d=e;d<=a;d++)s.push(d);let n=d=>{let p=ja(e,a,d.start,d.end),c=f=>{let m=f.style;m.setProperty("--dx-ev-top",`${p.top}%`),m.setProperty("--dx-ev-height",`${p.height}%`)};return i`<button
      class=${T("dx-plan-ev",d.tone&&`is-${d.tone}`)}
      ref=${c}
      @click=${()=>t.onSelect?.(d.id)}
    >
      <span class="dx-plan-ev-time">${d.start}–${d.end}</span>
      <span class="dx-plan-ev-title">${d.title}</span>
    </button>`},o=d=>i`<div class="dx-plan-col" role="gridcell" data-day=${d}>
      ${s.map(()=>i`<div class="dx-plan-slot" aria-hidden="true"></div>`)}
      ${D(()=>$(t.events).filter(p=>p.day===d),p=>p.id,n)}
    </div>`;return i`<div class="dx-plan" role="grid" aria-label="Weekly agenda">
    <div class="dx-plan-head" role="row">
      <div class="dx-plan-gutter-head" role="columnheader"></div>
      ${r.map(d=>i`<div class="dx-plan-col-head" role="columnheader">${l[d]}</div>`)}
    </div>
    <div class="dx-plan-body">
      <div class="dx-plan-gutter">
        ${s.map(d=>i`<div class="dx-plan-hour">${Pa(d)}:00</div>`)}
      </div>
      ${r.map(o)}
    </div>
  </div>`}function yl(t,e,a){if(e.length===0)return!0;let l=new Map;for(let r of e)(l.get(r.field)??l.set(r.field,[]).get(r.field)).push(r.value.toLowerCase());for(let[r,s]of l){let n=String(a(t,r)??"").toLowerCase();if(!s.some(o=>n.includes(o)))return!1}return!0}function kl(t){let e=y(""),a=y([]),l=y([]),r=y([]),s=y("none"),n=y(!1),o=null,d=()=>t.onChange?.({facets:a(),filters:l(),groupBy:r()}),p=v=>{let x=e().trim();x&&(a.set([...a(),{field:v.key,label:v.label,value:x}]),e.set(""),n.set(!1),d())},c=v=>{a.set(a().filter((x,h)=>h!==v)),d()},f=(v,x)=>{v.set(v().includes(x)?v().filter(h=>h!==x):[...v(),x]),d()},m=v=>{v.key==="Enter"?(v.preventDefault(),e().trim()&&p(t.fields[0])):v.key==="Backspace"&&e()===""&&a().length?c(a().length-1):v.key==="Escape"&&(n.set(!1),s.set("none"))};if(t.hotkey!==!1){let v=globalThis.document;if(v){let x=h=>{(h.ctrlKey||h.metaKey)&&(h.key==="k"||h.key==="K")&&(h.preventDefault(),o?.focus())};v.addEventListener("keydown",x),L(()=>v.removeEventListener("keydown",x))}}let w=(v,x)=>i`<span class="dx-sf-facet"><span class="dx-sf-facet-field">${v.label}</span>${v.value}<button class="dx-sf-facet-x" type="button" aria-label=${`Remove ${v.label}: ${v.value}`} @click=${()=>c(x)}>×</button></span>`,S=(v,x,h,u)=>i`
    <div class="dx-sf-menu">
      <button class="dx-sf-mbtn" type="button" aria-haspopup="menu" aria-expanded=${()=>s()===v?"true":"false"} @click=${()=>s.set(s()===v?"none":v)}>${x}<span class="dx-s2-caret" aria-hidden="true">▾</span></button>
      <div class="dx-sf-mlist" role="menu" ?hidden=${()=>s()!==v}>${h.map(g=>i`<button class=${()=>T("dx-sf-mitem",u().includes(g.id)&&"is-on")} role="menuitemcheckbox" type="button" aria-checked=${()=>u().includes(g.id)?"true":"false"} @click=${()=>f(u,g.id)}><span class="dx-sf-check" aria-hidden="true">✓</span>${g.label}</button>`)}</div>
    </div>`;return i`<div
    class="dx-sf"
    @focusout=${v=>{let x=v.currentTarget,h=v.relatedTarget;(!h||!x.contains(h))&&(n.set(!1),s.set("none"))}}
  >
    <div class="dx-sf-box">
      <span class="dx-sf-ico" aria-hidden="true">⌕</span>
      ${D(()=>a(),(v,x)=>`${v.field}:${v.value}:${x}`,w)}
      <input
        class="dx-sf-input"
        type="text"
        role="combobox"
        aria-expanded=${()=>n()?"true":"false"}
        aria-label="Search"
        placeholder=${t.placeholder??"Search\u2026"}
        .value=${()=>e()}
        ref=${v=>o=v}
        @input=${v=>{e.set(v.target.value),n.set(e().length>0)}}
        @focus=${()=>n.set(e().length>0)}
        @keydown=${m}
      />
      <kbd class="dx-sf-kbd" aria-hidden="true">⌘K</kbd>
    </div>
    ${t.filters?.length?S("filters","Filters",t.filters,l):""}
    ${t.groupBy?.length?S("groupby","Group By",t.groupBy,r):""}
    <div class="dx-sf-suggest" role="listbox" ?hidden=${()=>!n()}>${()=>e().trim()?t.fields.map(v=>i`<button class="dx-sf-sugg" role="option" type="button" @click=${()=>p(v)}>Search <b>${v.label}</b> for “<span class="dx-sf-q">${()=>e()}</span>”</button>`):""}</div>
  </div>`}function wl(t){let e=y(!1),a=s=>i`<button
      class=${s.active?"dx-nav-item is-active":"dx-nav-item"}
      aria-current=${s.active?"page":!1}
      @click=${()=>{s.onSelect?.(),e.set(!1)}}
    >
      <span class="dx-dot" aria-hidden="true"></span>${s.label}
    </button>`,l=t.user?i`<div class="dx-user"><span class="dx-avatar">${t.user.initials}</span>${t.user.name}</div>`:"",r=t.search?i`<div class="dx-search"><input
        placeholder=${t.search.placeholder??"Search\u2026"}
        aria-label=${t.search.placeholder??"Search"}
        type="search"
        @input=${s=>t.search.onInput?.(s.target.value)}
      /></div>`:t.topbar?i`${()=>$(t.topbar)}`:i`<div class="dx-search"></div>`;return i`<div class=${()=>T("dx-shell",e()&&"is-nav-open")}>
    <div class="dx-nav-backdrop" @click=${()=>e.set(!1)}></div>
    <aside class="dx-side">
      <div class="dx-brand">${t.brand}</div>
      <nav class="dx-nav" aria-label="Primary">${()=>$(t.nav).map(a)}</nav>
    </aside>
    <div class="dx-main">
      <header class="dx-top">
        <button
          class="dx-burger"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded=${()=>e()?"true":"false"}
          @click=${()=>e.set(!e())}
        >☰</button>
        ${r}${l}
      </header>
      <main class="dx-content">${()=>$(t.content)}</main>
    </div>
  </div>`}function Ba(t){let e=`dx-stat-delta is-${t.tone??"mut"}`;return i`<div class="dx-stat">
    <div class="dx-stat-label">${t.label}</div>
    <div class="dx-stat-value">${()=>$(t.value)}</div>
    ${t.delta?i`<div class=${e}>${()=>$(t.delta)}</div>`:""}
  </div>`}function Cl(t){return i`<div class="dx-stats">${D(t,e=>e.label,Ba)}</div>`}function Tl(t){let e=t.title?H("dx-card"):"";return i`<section class="dx-card" aria-labelledby=${e||!1}>
    ${t.title?i`<div class="dx-card-head"><h2 class="dx-card-title" id=${e}>${t.title}</h2></div>`:""}
    <div class="dx-card-body">${()=>$(t.body)}</div>
  </section>`}function Sl(t,e="mut"){return i`<span class=${`dx-pill is-${e}`}>${t}</span>`}var dt=(t,e)=>t.value?t.value(e):e[t.key]??"",ue=t=>{let e=t.align??(t.numeric?"right":null);return e?`dx-ta-${e}`:""};function Dl(t){let e=y(""),a=y(null),l=y(!1),r=y(0),s=t.pageSize??10,n=y(new Set),o=t.debounce??150,d=b=>{e.set(b),r.set(0)},p,c=b=>{if(o<=0){d(b);return}p&&clearTimeout(p),p=setTimeout(()=>d(b),o)},f=B(()=>{let b=e().trim().toLowerCase(),A=$(t.rows);return b?A.filter(F=>t.columns.some(N=>String(dt(N,F)).toLowerCase().includes(b))):A}),m=B(()=>{let b=a(),A=f();if(!b)return A;let F=t.columns.find(Q=>Q.key===b);if(!F)return A;let N=l()?-1:1;return[...A].sort((Q,X)=>{let $t=dt(F,Q),vt=dt(F,X);return typeof $t=="number"&&typeof vt=="number"?($t-vt)*N:String($t).localeCompare(String(vt))*N})}),w=B(()=>m().length),S=B(()=>Math.max(1,Math.ceil(w()/s))),v=B(()=>{let b=Math.min(r(),S()-1);return m().slice(b*s,b*s+s)}),x=b=>{b.sortable&&(a()===b.key?l.set(!l()):(a.set(b.key),l.set(!1)),r.set(0))},h=b=>{let A=T(b.sortable&&"is-sortable",ue(b)),F=()=>a()===b.key?l()?"\u25BC":"\u25B2":"",N=()=>b.sortable?a()===b.key?l()?"descending":"ascending":"none":!1,Q=X=>{b.sortable&&(X.key==="Enter"||X.key===" ")&&(X.preventDefault(),x(b))};return i`<th
      class=${A}
      aria-sort=${N}
      tabindex=${b.sortable?"0":!1}
      @click=${()=>x(b)}
      @keydown=${Q}
    >${b.label}<span class="dx-arrow" aria-hidden="true">${F}</span></th>`},u=b=>{n.set(b),t.onSelectionChange?.([...b])},g=(b,A)=>{let F=new Set(n());A?F.add(b):F.delete(b),u(F)},C=()=>v().map(b=>t.rowKey(b)),k=()=>{let b=C();return b.length>0&&b.every(A=>n().has(A))},R=b=>{let A=new Set(n());for(let F of C())b?A.add(F):A.delete(F);u(A)},_=(b,A)=>i`<td class=${T(b.numeric&&"dx-num",ue(b))}>${b.render?b.render(A):String(dt(b,A))}</td>`,Y=b=>{let A=t.rowKey(b),F=t.onRow?N=>{(N.key==="Enter"||N.key===" ")&&(N.preventDefault(),t.onRow(b))}:void 0;return i`<tr
      class=${()=>T(t.selectable&&n().has(A)&&"is-selected",t.onRow&&"is-click")}
      tabindex=${t.onRow?"0":!1}
      @click=${t.onRow?()=>t.onRow(b):void 0}
      @keydown=${F}
    >${t.selectable?i`<td class="dx-tbl-sel" @click=${N=>N.stopPropagation()}>${pt({checked:()=>n().has(A),onChange:N=>g(A,N)})}</td>`:""}${D(t.columns,N=>N.key,N=>_(N,b))}</tr>`},Z=()=>t.columns.length+(t.selectable?1:0),ve=()=>{let b=Math.min(s,5);return i`${Array.from({length:b},()=>i`<tr class="dx-tbl-skel" aria-hidden="true">${Array.from({length:Z()},()=>i`<td><span class="dx-skel dx-skel-line"></span></td>`)}</tr>`)}`},mt=()=>$(t.loading??!1),zt=()=>w()===0?0:Math.min(r(),S()-1)*s+1,xe=()=>Math.min(zt()+s-1,w());return i`<section class="dx-card">
    ${t.title?i`<div class="dx-card-head"><h2 class="dx-card-title">${t.title}</h2></div>`:""}
    <div class="dx-tbl-toolbar">
      ${t.search===!1?"":i`<div class="dx-tbl-search"><input
            placeholder="Search…"
            aria-label=${t.title?`Search ${t.title}`:"Search records"}
            type="search"
            @input=${b=>c(b.target.value)}
          /></div>`}
      <div class="dx-spacer"></div>
      ${t.toolbar??""}
      ${t.exportable?fe({rows:()=>m(),columns:t.columns.map(b=>({key:b.key,label:b.label,value:b.value})),filename:(t.exportable===!0?void 0:t.exportable.filename)??(t.title?t.title.toLowerCase().replace(/\s+/g,"-"):"export"),formats:t.exportable===!0?void 0:t.exportable.formats}):""}
    </div>
    <div class="dx-tbl-wrap">
      <table class=${T("dx-tbl",t.density==="compact"&&"is-compact",t.striped&&"is-striped",t.stickyHeader&&"is-sticky")} aria-label=${t.title??"Data table"}>
        <thead><tr>${t.selectable?i`<th class="dx-tbl-sel">${pt({checked:()=>k(),onChange:b=>R(b)})}</th>`:""}${D(t.columns,b=>b.key,h)}</tr></thead>
        <tbody>${()=>mt()?ve():""}${D(()=>mt()?[]:v(),b=>t.rowKey(b),Y)}</tbody>
      </table>
    </div>
    ${()=>!mt()&&w()===0?i`<div class="dx-tbl-empty" role="status">No records match your filter.</div>`:""}
    <div class="dx-tbl-foot">
      <span aria-live="polite">Showing ${zt} – ${xe} of ${w}</span>
      <div class="dx-spacer"></div>
      <button class="dx-btn" aria-label="Previous page" ?disabled=${()=>r()<=0} @click=${()=>r.set(Math.max(0,r()-1))}>‹ Prev</button>
      <span>Page ${()=>Math.min(r(),S()-1)+1} / ${S}</span>
      <button class="dx-btn" aria-label="Next page" ?disabled=${()=>r()>=S()-1} @click=${()=>r.set(Math.min(S()-1,r()+1))}>Next ›</button>
    </div>
  </section>`}function at(t){return typeof t=="string"?t:JSON.stringify(t,(e,a)=>a&&typeof a=="object"&&!Array.isArray(a)?{o:Object.keys(a).sort().map(l=>[l,a[l]])}:a)}var ht=()=>typeof Date<"u"?Date.now():0;function Ll(){let t=new Map,e=(r,s,n,o)=>{let d=t.get(r);return d?(d.fetcher=s,d.staleTime=n):(d={key:r,data:y(o),error:y(void 0),isFetching:y(!1),hasData:y(o!==void 0),fetcher:s,promise:null,updatedAt:o!==void 0?ht():0,observers:0,staleTime:n},t.set(r,d)),d},a=r=>{if(r.promise)return r.promise;z(()=>r.isFetching.set(!0));let s=r.fetcher().then(n=>{z(()=>{r.data.set(n),r.hasData.set(!0),r.error.set(void 0),r.updatedAt=ht()})},n=>{z(()=>r.error.set(n))}).finally(()=>{r.promise=null,z(()=>r.isFetching.set(!1))});return r.promise=s,s},l=r=>r.updatedAt===0||ht()-r.updatedAt>=r.staleTime;return{async invalidate(r){let s=at(r),n=[];for(let o of t.values())Ia(o.key,s)&&(o.updatedAt=0,o.observers>0&&n.push(a(o)));await Promise.all(n)},async prefetch(r,s,n={}){let o=e(at(r),s,n.staleTime??0,n.initialData);l(o)&&await a(o)},getData(r){let s=t.get(at(r));return s?z(()=>s.data()):void 0},setData(r,s){let n=at(r),o=t.get(n);o&&z(()=>{o.data.set(s),o.hasData.set(!0),o.updatedAt=ht()})},clear(){t.clear()},_query(r,s,n={}){let o=e(at(r),s,n.staleTime??0,n.initialData);o.observers++,L(()=>{o.observers--}),l(o)&&a(o);let d=(()=>o.data());return d.data=()=>o.data(),d.error=()=>o.error(),d.isFetching=()=>o.isFetching(),d.isLoading=()=>o.isFetching()&&!o.hasData(),d.refetch=()=>(o.updatedAt=0,a(o)),d}}}function Ia(t,e){if(e.endsWith("]")){let a=e.slice(0,-1);return t===e||t.startsWith(a+",")||t===a+"]"}return t===e}function El(t,e,a,l){return t._query(e,a,l)}function Fl(t){let e=t.initial,a=y({...e}),l=y({}),r=B(()=>t.validate?t.validate(a()):{}),s=B(()=>Object.keys(r()).length===0),n=B(()=>{let p=a();return Object.keys(e).some(c=>!Object.is(p[c],e[c]))}),o=(p,c)=>{a.update(f=>({...f,[p]:c}))},d=p=>{l.update(c=>c[p]?c:{...c,[p]:!0})};return{values:a,value:p=>()=>a()[p],setValue:o,errors:r,error:p=>()=>r()[p],touched:p=>()=>!!l()[p],dirty:n,isValid:s,field:p=>({value:()=>a()[p],onInput:c=>o(p,c.target.value),onBlur:()=>d(p)}),handleSubmit:p=>c=>{c?.preventDefault?.(),l.set(Object.keys(e).reduce((f,m)=>(f[m]=!0,f),{})),z(()=>s())&&p(z(()=>a()))},reset:()=>{a.set({...e}),l.set({})}}}function Ul(t){return e=>{let a=t.safeParse(e);if(a.success||!a.error)return{};let l={};for(let r of a.error.issues){let s=r.path[0];s!==void 0&&l[s]===void 0&&(l[s]=r.message)}return l}}export{Ue as Fragment,or as Outlet,Er as alert,wl as appShell,Qa as asyncList,re as asyncView,_r as avatar,Za as awaitBlock,mr as badge,Fa as barGeom,Ha as batch,Or as breadcrumb,ea as button,hr as buttonGroup,rl as calendar,Tl as card,cl as carousel,pt as checkbox,na as colLetter,dr as component,B as computed,_t as createContext,Fl as createForm,Ll as createQueryClient,W as createRoot,ir as createRouter,Ar as createThemeController,Dl as dataTable,Jr as datePicker,lr as defineElement,Wr as divider,Mt as download,J as easterPlus,he as easterSunday,j as effect,Pr as emptyState,Ga as escape,ja as eventGeom,fe as exportMenu,$a as exportTable,vr as field,$l as gantt,tl as holidayIndex,me as holidaysFor,i as html,ol as image,Wt as inject,aa as input,Ee as isUnsafeProp,Vt as isUrlAttr,Va as jsxElement,at as keyOf,D as list,yl as matchFacets,zr as meter,La as metric,sl as metricGrid,Rr as modal,St as mount,Hr as navPanel,Qr as nthWeekday,L as onCleanup,_a as onError,se as onMount,Sl as pill,xl as planner,jr as progress,Ft as project,kt as provide,El as query,gr as radioGroup,Xr as registerHolidays,te as render,Xe as resolveSize,Jt as sanitizeUrl,kl as searchFilter,Vr as searchableSelect,qr as segmented,xr as select,qa as setInspector,y as signal,q as sizeClass,Fr as skeleton,Ta as sparkline,Ur as spinner,hl as starRating,Ba as statCard,Cl as statGrid,Xa as streamList,Ya as suspense,br as switchToggle,wr as tableList,Ir as tabs,$r as textarea,Yr as timer,ee as toAsyncSource,la as toCsv,sa as toXls,ma as toXlsx,Nr as tooltip,z as untrack,dl as video,Dr as virtualList,ba as visibleRange,Oa as withoutInspector,pl as worldMap,Ul as zodValidate};
