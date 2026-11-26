var B=null,$e=0,lt=!1;function za(t){B=t}function Pa(t){let e=lt;lt=!0;try{return t()}finally{lt=e}}function yt(t,e,a){if(!B||t.ignored)return;let s={id:++$e,kind:e,name:a};t.inspect=s,B.onCreate?.(s)}var z=null,U=null,K=0,st=[],xt=!1,ve=()=>!1;function rt(t,e,a,s){let l=s&&s.equals===!1?ve:s&&s.equals||Object.is;return{value:t,fn:e,state:0,sources:null,observers:null,equals:l,effect:a,init:!1,disposed:!1,queued:!1,owned:null,cleanups:null,parent:U,errorHandlers:null,inspect:null,ignored:lt||!!(U&&U.ignored)}}function Pt(t){U&&(U.owned||=[]).push(t)}function Bt(t){return t.fn&&!t.effect&&nt(t),z&&((z.sources||=new Set).add(t),(t.observers||=new Set).add(z)),t.value}function bt(t,e){if(t.equals(t.value,e))return t.value;if(t.value=e,t.inspect&&B?.onUpdate?.(t.inspect,e),t.observers)for(let a of t.observers)It(a,2);return K||Ht(),t.value}function It(t,e){if(t.state<e){let a=t.state===0;if(t.state=e,a){if(t.effect)qt(t);else if(t.observers)for(let s of t.observers)It(s,1)}}}function qt(t){t.queued||(t.queued=!0,st.push(t))}function nt(t){if(t.state!==0){if(t.state===1&&t.sources){for(let e of t.sources)if(e.fn&&!e.effect&&nt(e),t.state===2)break}t.state===2&&xe(t),t.state=0}}function xe(t){Ot(t,!1);let e=z,a=U;z=t,U=t;let s,l=!1,r;try{s=t.fn()}catch(n){l=!0,r=n}finally{z=e,U=a}if(l){if(t.owned){for(let n of t.owned)it(n);t.owned=null}if(!be(t,r))throw r;return}if(t.inspect&&B?.onRun?.(t.inspect),t.effect)typeof s=="function"&&(t.cleanups||=[]).push(s);else if((!t.init||!t.equals(t.value,s))&&(t.value=s,t.init=!0,t.inspect&&B?.onUpdate?.(t.inspect,s),t.observers))for(let n of t.observers)n.state<2&&(n.state=2)}function be(t,e){let a=t;for(;a;){let s=a.errorHandlers;if(s&&s.length)return I(()=>{for(let l of s)l(e)}),!0;a=a.parent}return!1}function Ot(t,e){if(t.owned){for(let a of t.owned)it(a);t.owned=null}if(t.cleanups){for(let a of t.cleanups)a();t.cleanups=null}if(t.sources){for(let a of t.sources)a.observers&&a.observers.delete(t);t.sources=null}if(e&&(t.disposed=!0,t.observers)){for(let a of t.observers)a.sources&&a.sources.delete(t);t.observers=null}}function it(t){t.disposed||(t.inspect&&B?.onDispose?.(t.inspect),Ot(t,!0))}var ge=1e6;function Ht(){if(xt||K)return;xt=!0;let t,e=!1;try{let a=0;for(;a<st.length;a++){if(a>ge)throw new Error("dxjs: potential infinite update loop");let s=st[a];if(s.queued=!1,!s.disposed)try{nt(s)}catch(l){e||(e=!0,t=l)}}}finally{st.length=0,xt=!1}if(e)throw t}function y(t,e){let a=rt(t,null,!1,e);B&&(yt(a,"signal",e?.name),a.inspect&&B.onUpdate?.(a.inspect,t));let s=((...l)=>{if(l.length===0)return Bt(a);let r=l[0],n=typeof r=="function"?r(a.value):r;return bt(a,n)});return s.set=l=>bt(a,l),s.update=l=>bt(a,l(a.value)),s.peek=()=>a.value,s}function P(t,e){let a=rt(void 0,t,!1,e);return a.state=2,Pt(a),B&&yt(a,"computed",e?.name),()=>Bt(a)}function j(t,e){let a=rt(void 0,t,!0);return a.state=2,Pt(a),B&&yt(a,"effect",e),K?qt(a):nt(a),()=>it(a)}function Ba(t){if(K)return t();K++;try{return t()}finally{K--,Ht()}}function I(t){let e=z;z=null;try{return t()}finally{z=e}}function L(t){U&&(U.cleanups||=[]).push(t)}function Ia(t){U&&(U.errorHandlers||=[]).push(t)}function G(t){let e=rt(void 0,null,!1),a=z,s=U;z=null,U=e;try{return t(()=>it(e))}finally{z=a,U=s}}var gt=new Map;function _t(t){return{id:Symbol("dx-context"),defaultValue:t}}function kt(t,e,a){let s=gt.get(t.id);s||(s=[],gt.set(t.id,s)),s.push(e);try{return a()}finally{s.pop()}}function Wt(t){let e=gt.get(t.id);return e&&e.length?e[e.length-1]:t.defaultValue}var ye={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},ke=/[&<>"']/g;function Ha(t){return String(t).replace(ke,e=>ye[e])}var we=new Set(["href","src","action","formaction","xlink:href","poster","data","ping","background","cite","longdesc","usemap"]),Ce=/^(?:javascript|vbscript):/i,Te=/^data:(?:image|audio|video|font)\//i,De=/[\u0000-\u0020]+/g;function Vt(t){return we.has(t.toLowerCase())}var Se=new Set(["innerhtml","outerhtml","srcdoc"]);function Me(t){return Se.has(t.toLowerCase())}function Jt(t){let e=t.replace(De,"").toLowerCase();return Ce.test(e)||e.startsWith("data:")&&!Te.test(t.trim())?"":t}var wt="__dxm_attr__",Ct="dxm",Ae=1,Ee=8;function i(t,...e){return{_dx:!0,strings:t,values:e}}function Le(t){return!!t&&typeof t=="object"&&t._dx===!0}var Re=Symbol.for("dxjs.Fragment");function _a(t,e){return{_dxel:!0,type:t,props:e??{}}}function Fe(t){return!!t&&typeof t=="object"&&t._dxel===!0}var Kt=new WeakMap;function Ne(t){let e=[],a=!1,s="";for(let l=0;l<t.length;l++){let r=t[l];for(let n=0;n<r.length;n++){let o=r[n];s?o===s&&(s=""):a?o==='"'||o==="'"?s=o:o===">"&&(a=!1):o==="<"&&(a=!0)}l<t.length-1&&e.push(a?"attr":"child")}return e}function Ue(t){let e=Kt.get(t);if(e)return e;let a=Ne(t),s="";for(let r=0;r<t.length;r++)s+=t[r],r<t.length-1&&(s+=a[r]==="child"?`<!--${Ct}-->`:wt);let l=document.createElement("template");return l.innerHTML=s,Kt.set(t,l),l}function V(t){return typeof t=="function"?t():t}function je(t,e,a,s){if(e==="ref"){t.removeAttribute(e),typeof a=="function"&&a(t);return}let l=e[0];if(l==="@"){let r=e.slice(1);if(t.removeAttribute(e),typeof a=="function"){let n=a;t.addEventListener(r,n),s.push(()=>t.removeEventListener(r,n))}return}if(l==="."){let r=e.slice(1);if(t.removeAttribute(e),Me(r))return;s.push(j(()=>{t[r]=V(a)}));return}if(l==="?"){let r=e.slice(1);t.removeAttribute(e),s.push(j(()=>{t.toggleAttribute(r,!!V(a))}));return}if(/^on/i.test(e)){t.removeAttribute(e);return}s.push(j(()=>{let r=V(a);if(r==null||r===!1)t.removeAttribute(e);else{let n=r===!0?"":String(r);t.setAttribute(e,Vt(e)?Jt(n):n)}}))}function ot(t){return t==null||t===!1||t===!0||t===""?{nodes:[],dispose:()=>{}}:Le(t)?Xt(t):Fe(t)?qe(t):{nodes:[document.createTextNode(String(t))],dispose:()=>{}}}var ze={nodes:[],dispose:()=>{}};function Pe(t){return t.replace(/[A-Z]/g,e=>"-"+e.toLowerCase())}var Be=new Set(["value","checked","selected","indeterminate"]);function Ie(t,e,a,s){if(e!=="key"){if(e==="ref"){typeof a=="function"&&a(t);return}if(e.length>2&&e[0]==="o"&&e[1]==="n"){let l=e[2],r=l===":"?e.slice(3):l>="A"&&l<="Z"?e.slice(2).toLowerCase():"";if(r){if(typeof a=="function"){let n=a;t.addEventListener(r,n),s.push(()=>t.removeEventListener(r,n))}return}return}if(e==="className"&&(e="class"),e==="style"&&a!==null&&typeof a=="object"&&typeof a!="function"){let l=t.style;for(let r in a)l.setProperty(Pe(r),String(a[r]));return}if(Be.has(e)){s.push(j(()=>{t[e]=V(a)}));return}s.push(j(()=>{let l=V(a);if(l==null||l===!1)t.removeAttribute(e);else{let r=l===!0?"":String(l);t.setAttribute(e,Vt(e)?Jt(r):r)}}))}}function Gt(t){let e=document.createDocumentFragment(),a=[],s=l=>{if(l==null||l===!1||l===!0||l==="")return;if(Array.isArray(l)){for(let n of l)s(n);return}if(typeof l=="function"||Yt(l)){let n=document.createComment(Ct);e.appendChild(n),Zt(n,l,a);return}let r=ot(l);for(let n of r.nodes)e.appendChild(n);a.push(r.dispose)};return s(t),{nodes:[...e.childNodes],dispose:()=>a.forEach(l=>l())}}function qe(t){let{type:e,props:a}=t;if(e===Re)return Gt(a.children);if(typeof e=="function")return ot(e(a));if(typeof e!="string")return ze;let s=document.createElement(e),l=[];for(let r in a)r!=="children"&&Ie(s,r,a[r],l);if("children"in a){let r=Gt(a.children);for(let n of r.nodes)s.appendChild(n);l.push(r.dispose)}return{nodes:[s],dispose:()=>l.forEach(r=>r())}}function S(t,e,a){return{_dxlist:!0,items:t,key:e,render:a}}function Yt(t){return!!t&&typeof t=="object"&&t._dxlist===!0}function Zt(t,e,a){let s=t.parentNode,l=document.createTextNode("");s.insertBefore(l,t),s.removeChild(t);let r=()=>l.parentNode??s,n=[],o=[],d=()=>{for(let c of o)c();o=[];for(let c of n)c.parentNode&&c.parentNode.removeChild(c);n=[]},p=c=>{let f=Array.isArray(c)?c:[c],m=r();for(let k of f){let D=ot(k);for(let b of D.nodes)m.insertBefore(b,l);n.push(...D.nodes),o.push(D.dispose)}};if(Yt(e)){let c=e,f=new Map;a.push(j(()=>{let m=typeof c.items=="function"?c.items():c.items,k=new Set,D=[];m.forEach((v,h)=>{let u=c.key(v,h);k.add(u);let g=f.get(u);if(!g){let T=Xt(c.render(v,h));g={nodes:T.nodes,dispose:T.dispose},f.set(u,g)}D.push(g)});for(let[v,h]of f)if(!k.has(v)){h.dispose();for(let u of h.nodes)u.parentNode&&u.parentNode.removeChild(u);f.delete(v)}let b=r();for(let v of D)for(let h of v.nodes)b.insertBefore(h,l)})),a.push(()=>{for(let[,m]of f)m.dispose();f.clear()});return}a.push(j(()=>{let c=V(e);d(),p(c)})),a.push(d)}function Qt(t,e,a,s){if(t.nodeType===Ae){let l=t;for(let r of[...l.attributes])if(r.value===wt)je(l,r.name,e[a.v++],s);else if(r.value.includes(wt))throw new Error("dxjs: an interpolation must be the entire attribute value")}for(let l of[...t.childNodes])l.nodeType===Ee&&l.data===Ct?Zt(l,e[a.v++],s):Qt(l,e,a,s)}function Xt(t){let e=Ue(t.strings).content.cloneNode(!0),a=[];return Qt(e,t.values,{v:0},a),{nodes:[...e.childNodes],dispose:()=>{for(let s of a)s()}}}function te(t,e){return G(a=>{let s=ot(t);for(let l of s.nodes)e.appendChild(l);return L(()=>{s.dispose();for(let l of s.nodes)l.parentNode&&l.parentNode.removeChild(l)}),a})}function Oe(t){return t.replace(/-([a-z])/g,(e,a)=>a.toUpperCase())}function Ja(t,e,a={}){let s=globalThis.customElements;if(!s||s.get(t))return;let l=a.attributes??[],r=a.shadow;class n extends HTMLElement{constructor(){super(),this.sigs=new Map,this.dispose=null;for(let d of l)this.sigs.set(d,y(null))}static get observedAttributes(){return l}connectedCallback(){for(let c of l)this.sigs.get(c).set(this.getAttribute(c));let d={};for(let[c,f]of this.sigs)d[Oe(c)]=()=>f();let p=r?this.attachShadow(typeof r=="object"?r:{mode:"open"}):this;this.dispose=Dt(e,p,d)}attributeChangedCallback(d,p,c){this.sigs.get(d)?.set(c)}disconnectedCallback(){this.dispose?.(),this.dispose=null}}s.define(t,n)}function He(t){try{return decodeURIComponent(t)}catch{return t}}var Tt=_t(null);function _e(t){let e=[];for(let a of t.split("/"))a.startsWith(":")?e.push(a.slice(1)):a==="*"&&e.push("rest");return e}function We(t,e){let a=t.replace(/\/+$/,""),s=e.replace(/^\/+/,"");return s?(a===""?"":a)+"/"+s:a===""?"/":a}function ee(t,e,a){let s=[];for(let l of t){let r=We(e,l.path),n=[...a,l];l.children&&l.children.length?s.push(...ee(l.children,r,n)):s.push({chain:n,pattern:r,levelNames:n.map(o=>_e(o.path))})}return s}function Ke(t){if(t==="/"||t==="")return{re:/^\/?$/,names:[]};let e=[],a="^";for(let s of t.split("/"))s!==""&&(a+="/",s.startsWith(":")?(e.push(s.slice(1)),a+="([^/]+)"):s==="*"?(e.push("rest"),a+="(.*)"):a+=s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));return a+="/?$",{re:new RegExp(a),names:e}}function Ge(){let t=globalThis.location;return{pathname:t?.pathname??"/",search:t?.search??""}}function Qa(t,e={}){let a=ee(t,"",[]).map(f=>{let{re:m,names:k}=Ke(f.pattern);return{...f,re:m,names:k}}),s=y([]);function l(f,m,k,D){let b={};return f.names.forEach((v,h)=>{b[v]=He(m[h+1]??"")}),f.chain.map((v,h)=>{let u=y(void 0),g={path:k,params:b,query:D,data:()=>u()};if(v.loader){let R=v.loader(g);R&&typeof R.then=="function"?R.then(_=>u.set(_)).catch(()=>u.set(void 0)):u.set(R)}let T=f.levelNames[h]??[],w=v.path+"|"+T.map(R=>b[R]).join(",");return{route:v,ctx:g,key:w}})}let r=()=>{let{pathname:f,search:m}=Ge(),k=new URLSearchParams(m);for(let D of a){let b=D.re.exec(f);if(!b)continue;let v=l(D,b,f,k),h=!1;for(let u of v){let g=u.route.guard;if(!g)continue;let T=g(u.ctx);if(T===!1){h=!0;break}if(typeof T=="string"){n(T,{replace:!0});return}}if(h)break;s.set(v);return}e.fallback&&f!==e.fallback?n(e.fallback,{replace:!0}):s.set([])};function n(f,m={}){let k=globalThis.history;k&&k[m.replace?"replaceState":"pushState"](null,"",f),r()}let o=()=>r(),d=globalThis.addEventListener?globalThis:void 0;d&&d.addEventListener("popstate",o),r();function p(f,m){let k=null,D,b=0,v=j(()=>{let h=s()[m],u=h?h.key:null;if(u===D)return;D=u;let g=++b;if(k&&(k(),k=null),!h)return;let T={matches:()=>s(),depth:m+1},w=R=>{g===b&&(k=kt(Tt,T,()=>Dt(R,f,h.ctx)))};h.route.component?w(h.route.component):h.route.load&&h.route.load().then(R=>w(R.default))});L(()=>{v(),k&&k()})}function c(f){return G(m=>(p(f,0),m))}return{current:()=>{let f=s(),m=f[f.length-1];return m?{route:m.route,ctx:m.ctx}:null},matches:()=>s(),navigate:n,outlet:c,dispose(){d&&d.removeEventListener("popstate",o)}}}function Xa(){let t=Wt(Tt);return i`<dx-outlet
    ref=${e=>{if(!t)return;let a=null,s,l=0,r=j(()=>{let n=t.matches()[t.depth],o=n?n.key:null;if(o===s)return;s=o;let d=++l;if(a&&(a(),a=null),!n)return;let p={matches:t.matches,depth:t.depth+1},c=f=>{d===l&&(a=kt(Tt,p,()=>Dt(f,e,n.ctx)))};n.route.component?c(n.route.component):n.route.load&&n.route.load().then(f=>c(f.default))});L(()=>{r(),a&&a()})}}
  ></dx-outlet>`}var tt=null;function tl(t){return t}function ae(t){if(tt)tt.push(t);else{let e=t();typeof e=="function"&&L(e)}}function Dt(t,e,a){return G(s=>{let l=[],r=tt;tt=l;let n;try{n=t(a)}finally{tt=r}let o=te(n,e);L(o);for(let d of l){let p=d();typeof p=="function"&&L(p)}return s})}var Ve=["xs","sm","md","lg","xl","xxl"],Je=t=>typeof t=="number"?Ve[Math.min(6,Math.max(1,t))-1]??"md":t??"md",q=t=>{let e=Je(t);return e==="md"?"":`dx-sz-${e}`},$=t=>typeof t=="function"?t():t,Ye=0,H=t=>`${t}-${++Ye}`,C=(...t)=>t.filter(Boolean).join(" ");function Ze(t){let e=C("dx-btn",t.variant&&t.variant!=="default"&&`is-${t.variant}`,q(t.size),t.block&&"is-block",!t.label&&"is-icon");return i`<button
    class=${e}
    type=${t.type??"button"}
    aria-label=${t.ariaLabel??!1}
    aria-busy=${()=>$(t.loading??!1)?"true":!1}
    ?disabled=${()=>$(t.disabled??!1)||$(t.loading??!1)}
    @click=${a=>t.onClick?.(a)}
  >${()=>$(t.loading??!1)?i`<span class="dx-spinner dx-btn-spin" aria-hidden="true"></span>`:t.icon?i`<span class="dx-btn-ico" aria-hidden="true">${()=>$(t.icon)}</span>`:""}${()=>$(t.label??"")}</button>`}function rl(t){return i`<div class="dx-btn-group" role="group">${t}</div>`}function nl(t,e="mut"){return i`<span class=${`dx-badge is-${e}`}>${()=>$(t)}</span>`}function Qe(t){return i`<input
    class=${C("dx-input",q(t.size))}
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
  />`}function il(t){return i`<textarea
    class=${C("dx-input dx-textarea",q(t.size))}
    id=${t.id??!1}
    rows=${t.rows??3}
    placeholder=${t.placeholder??!1}
    aria-label=${t.ariaLabel??!1}
    aria-invalid=${()=>$(t.invalid??!1)?"true":!1}
    .value=${()=>$(t.value??"")}
    ?disabled=${()=>$(t.disabled??!1)}
    @input=${e=>t.onInput?.(e.target.value,e)}
    @blur=${e=>t.onBlur?.(e)}
  ></textarea>`}function ol(t){let e=t.id??H("dx-f"),a=H("dx-fh"),s=()=>!!$(t.error??!1)||$(t.invalid??!1),l=t.control?t.control({id:e,invalid:s,ariaDescribedby:a}):Qe({...t,id:e,invalid:s,ariaDescribedby:a});return i`<div class="dx-field">
    <label class="dx-field-label" for=${e}>${t.label}${t.required?i`<span class="dx-req" aria-hidden="true">*</span>`:""}</label>
    ${l}
    ${()=>{let r=$(t.error??!1);return r?i`<p class="dx-field-msg is-error" id=${a} role="alert">${r}</p>`:t.hint?i`<p class="dx-field-msg" id=${a}>${t.hint}</p>`:""}}
  </div>`}function dl(t){return i`<select
    class=${C("dx-select",q(t.size))}
    id=${t.id??!1}
    aria-label=${t.ariaLabel??!1}
    .value=${()=>$(t.value??"")}
    ?disabled=${()=>$(t.disabled??!1)}
    @change=${e=>t.onChange?.(e.target.value)}
  >${t.placeholder?i`<option value="" disabled>${t.placeholder}</option>`:""}${S(()=>$(t.options),e=>e.value,e=>i`<option value=${e.value} ?disabled=${e.disabled??!1}>${e.label}</option>`)}</select>`}function cl(t){let e=t.id??H("dx-sw");return i`<button
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
  </label>`}function ul(t){let e=t.name??H("dx-rg");return i`<div class="dx-radios" role="radiogroup" aria-label=${t.ariaLabel??!1}>${S(()=>$(t.options),a=>a.value,a=>{let s=H("dx-r");return i`<label class="dx-radio" for=${s}>
        <input
          type="radio"
          id=${s}
          name=${e}
          value=${a.value}
          class="dx-radio-input"
          .checked=${()=>$(t.value??"")===a.value}
          ?disabled=${a.disabled??!1}
          @change=${()=>t.onChange?.(a.value)}
        />
        <span class="dx-radio-dot" aria-hidden="true"></span><span class="dx-radio-label">${a.label}</span>
      </label>`})}</div>`}var jt=(t,e)=>t.value?t.value(e):e[t.key]??"",de=t=>typeof t=="number"&&Number.isFinite(t),Xe=/^[=+\-@\t\r]/,le=t=>{let e=String(t);return Xe.test(e)&&(e="'"+e),/[",\r\n]/.test(e)?`"${e.replace(/"/g,'""')}"`:e};function ta(t,e){let a=e.map(l=>le(l.label)).join(","),s=t.map(l=>e.map(r=>le(jt(r,l))).join(",")).join(`\r
`);return s?`${a}\r
${s}`:a}var ct=t=>String(t).replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[e]);function ea(t,e){let a=e.map(l=>`<th>${ct(l.label)}</th>`).join(""),s=t.map(l=>`<tr>${e.map(r=>{let n=jt(r,l);return de(n)?`<td style="mso-number-format:General">${ct(n)}</td>`:`<td>${ct(n)}</td>`}).join("")}</tr>`).join("");return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1"><thead><tr>${a}</tr></thead><tbody>${s}</tbody></table></body></html>`}var W=new TextEncoder;function aa(t){let e="",a=t;do e=String.fromCharCode(65+a%26)+e,a=Math.floor(a/26)-1;while(a>=0);return e}function la(t,e){let a=(r,n,o)=>{let d=`${aa(r)}${n}`;return de(o)?`<c r="${d}"><v>${o}</v></c>`:`<c r="${d}" t="inlineStr"><is><t xml:space="preserve">${ct(o)}</t></is></c>`},s=`<row r="1">${e.map((r,n)=>a(n,1,r.label)).join("")}</row>`,l=t.map((r,n)=>`<row r="${n+2}">${e.map((o,d)=>a(d,n+2,jt(o,r))).join("")}</row>`).join("");return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s}${l}</sheetData></worksheet>`}var sa=(()=>{let t=new Uint32Array(256);for(let e=0;e<256;e++){let a=e;for(let s=0;s<8;s++)a=a&1?3988292384^a>>>1:a>>>1;t[e]=a>>>0}return t})();function ra(t){let e=4294967295;for(let a=0;a<t.length;a++)e=sa[(e^t[a])&255]^e>>>8;return(e^4294967295)>>>0}function na(t){let e=[],a=[],s=0,l=m=>new Uint8Array([m&255,m>>>8&255]),r=m=>new Uint8Array([m&255,m>>>8&255,m>>>16&255,m>>>24&255]),n=m=>{e.push(m),s+=m.length};for(let m of t){let k=W.encode(m.name),D=ra(m.data);a.push({name:m.name,data:m.data,crc:D,offset:s}),n(r(67324752)),n(l(20)),n(l(0)),n(l(0)),n(l(0)),n(l(0)),n(r(D)),n(r(m.data.length)),n(r(m.data.length)),n(l(k.length)),n(l(0)),n(k),n(m.data)}let o=s;for(let m of a){let k=W.encode(m.name);n(r(33639248)),n(l(20)),n(l(20)),n(l(0)),n(l(0)),n(l(0)),n(l(0)),n(r(m.crc)),n(r(m.data.length)),n(r(m.data.length)),n(l(k.length)),n(l(0)),n(l(0)),n(l(0)),n(l(0)),n(r(0)),n(r(m.offset)),n(k)}let d=s-o;n(r(101010256)),n(l(0)),n(l(0)),n(l(a.length)),n(l(a.length)),n(r(d)),n(r(o)),n(l(0));let p=e.reduce((m,k)=>m+k.length,0),c=new Uint8Array(p),f=0;for(let m of e)c.set(m,f),f+=m.length;return c}var ia=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,oa=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,da=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,ca=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;function ua(t,e){return na([{name:"[Content_Types].xml",data:W.encode(ia)},{name:"_rels/.rels",data:W.encode(oa)},{name:"xl/workbook.xml",data:W.encode(da)},{name:"xl/_rels/workbook.xml.rels",data:W.encode(ca)},{name:"xl/worksheets/sheet1.xml",data:W.encode(la(t,e))}])}var St={csv:"text/csv;charset=utf-8",xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};function Mt(t,e,a){let s=globalThis.document,l=globalThis.URL;if(!s||!l)return;let r=new Blob([e],{type:a}),n=l.createObjectURL(r),o=s.createElement("a");o.href=n,o.download=t,s.body.appendChild(o),o.click(),o.remove(),l.revokeObjectURL(n)}function pa(t,e,a,s="export"){return a==="csv"?Mt(`${s}.csv`,ta(t,e),St.csv):a==="xls"?Mt(`${s}.xls`,ea(t,e),St.xls):Mt(`${s}.xlsx`,ua(t,e),St.xlsx)}var fa={csv:"CSV",xls:"Excel (.xls)",xlsx:"Excel (.xlsx)"};function ce(t){let e=y(!1),a=t.formats??["csv","xls","xlsx"],s=l=>{pa(t.rows(),t.columns,l,t.filename??"export"),e.set(!1)};return i`<div
    class="dx-export"
    @focusout=${l=>{let r=l.currentTarget,n=l.relatedTarget;(!n||!r.contains(n))&&e.set(!1)}}
  >
    <button class="dx-btn dx-export-btn" type="button" aria-haspopup="menu" aria-expanded=${()=>e()?"true":"false"} @click=${()=>e.set(!e())}>
      <span class="dx-export-ico" aria-hidden="true">⤓</span>${t.label??"Export"}<span class="dx-s2-caret" aria-hidden="true">▾</span>
    </button>
    <div class="dx-export-menu" role="menu" ?hidden=${()=>!e()}>${a.map(l=>i`<button class="dx-export-item" role="menuitem" type="button" @click=${()=>s(l)}>${fa[l]}</button>`)}</div>
  </div>`}var At=(t,e)=>t.value?t.value(e):e[t.key]??"",se=t=>{let e=t.align??(t.numeric?"right":null);return e?`dx-ta-${e}`:""};function hl(t){let e=t.columns.map(u=>({key:u.key,label:u.label,value:u.value})),a=t.exportable===!0?{}:t.exportable||null,s=y(null),l=y(!1),r=P(()=>{let u=s(),g=$(t.rows);if(!u)return g;let T=t.columns.find(R=>R.key===u);if(!T)return g;let w=l()?-1:1;return[...g].sort((R,_)=>{let Y=At(T,R),Z=At(T,_);return typeof Y=="number"&&typeof Z=="number"?(Y-Z)*w:String(Y).localeCompare(String(Z))*w})}),n=u=>{u.sortable&&(s()===u.key?l.set(!l()):(s.set(u.key),l.set(!1)))},o=y(new Set),d=u=>{o.set(u),t.onSelectionChange?.([...u])},p=(u,g)=>{let T=new Set(o());g?T.add(u):T.delete(u),d(T)},c=()=>$(t.rows).map(u=>t.rowKey(u)),f=()=>{let u=c();return u.length>0&&u.every(g=>o().has(g))},m=u=>{let g=new Set(o());for(let T of c())u?g.add(T):g.delete(T);d(g)},k=u=>{let g=C(u.sortable&&"is-sortable",u.numeric&&"dx-num",se(u)),T=()=>s()===u.key?l()?"\u25BC":"\u25B2":"",w=()=>u.sortable?s()===u.key?l()?"descending":"ascending":"none":!1,R=_=>{u.sortable&&(_.key==="Enter"||_.key===" ")&&(_.preventDefault(),n(u))};return i`<th
      class=${g}
      aria-sort=${w}
      tabindex=${u.sortable?"0":!1}
      @click=${()=>n(u)}
      @keydown=${R}
    >${u.label}<span class="dx-arrow" aria-hidden="true">${T}</span></th>`},D=u=>{let g=t.rowKey(u),T=t.onRow?w=>{(w.key==="Enter"||w.key===" ")&&(w.preventDefault(),t.onRow(u))}:void 0;return i`<tr
      class=${()=>C(t.selectable&&o().has(g)&&"is-selected",t.onRow&&"is-click")}
      tabindex=${t.onRow?"0":!1}
      @click=${t.onRow?()=>t.onRow(u):void 0}
      @keydown=${T}
    >${t.selectable?i`<td class="dx-tbl-sel" @click=${w=>w.stopPropagation()}>${pt({checked:()=>o().has(g),onChange:w=>p(g,w)})}</td>`:""}${S(t.columns,w=>w.key,w=>i`<td class=${C(w.numeric&&"dx-num",se(w))}>${w.render?w.render(u):String(At(w,u))}</td>`)}</tr>`},b=()=>t.columns.length+(t.selectable?1:0),v=()=>i`${Array.from({length:4},()=>i`<tr class="dx-tbl-skel" aria-hidden="true">${Array.from({length:b()},()=>i`<td><span class="dx-skel dx-skel-line"></span></td>`)}</tr>`)}`,h=()=>$(t.loading??!1);return i`<section class="dx-card">
    ${t.title||a||t.toolbar?i`<div class="dx-tbl-toolbar">
          ${t.title?i`<h2 class="dx-card-title">${t.title}</h2>`:""}
          <div class="dx-spacer"></div>
          ${t.toolbar??""}
          ${a?ce({rows:()=>r(),columns:e,filename:a.filename,formats:a.formats}):""}
        </div>`:""}
    <div class="dx-tbl-wrap">
      <table class=${C("dx-tbl",t.density==="compact"&&"is-compact",t.striped&&"is-striped",t.stickyHeader&&"is-sticky")} aria-label=${t.title??"Data"}>
        <thead><tr>${t.selectable?i`<th class="dx-tbl-sel">${pt({checked:()=>f(),onChange:u=>m(u)})}</th>`:""}${S(t.columns,u=>u.key,k)}</tr></thead>
        <tbody>${()=>h()?v():""}${S(()=>h()?[]:r(),u=>t.rowKey(u),D)}</tbody>
      </table>
    </div>
  </section>`}var ha=t=>typeof t=="function"?t():t;function ma(t,e,a,s,l=4){if(s===0||e<=0)return{start:0,end:0};let r=Math.floor(t/e),n=Math.ceil(a/e),o=Math.max(0,r-l),d=Math.min(s,r+n+l);return{start:o,end:d}}var $a=0;function xl(t){let e=`dxv${$a++}`,a=y(0),s=t.overscan??4,l=()=>ha(t.rows),r=()=>ma(a(),t.rowHeight,t.height,l().length,s),n=()=>{let{start:o,end:d}=r(),p=l(),c=[];for(let f=o;f<d;f++)c.push({row:p[f],index:f});return c};return ae(()=>{let o=document.querySelector(`[data-dxv="${e}"]`);if(!o)return;let d=o.querySelector(".dx-vlist-sizer"),p=o.querySelector(".dx-vlist-win");o.style.height=`${t.height}px`,p.style.setProperty("--dxv-h",`${t.rowHeight}px`);let c=()=>{a.set(o.scrollTop)};o.addEventListener("scroll",c,{passive:!0});let f=j(()=>{d.style.height=`${l().length*t.rowHeight}px`,p.style.transform=`translateY(${r().start*t.rowHeight}px)`});L(()=>{o.removeEventListener("scroll",c),f()})}),i`<div class="dx-vlist" data-dxv=${e}>
    <div class="dx-vlist-sizer"></div>
    <div class="dx-vlist-win">${S(()=>n(),o=>t.key(o.row,o.index),o=>i`<div class="dx-vlist-row">${t.render(o.row,o.index)}</div>`)}</div>
  </div>`}function va(){return globalThis.document?.documentElement??null}function Et(t){let e=va();e&&(t==="system"?e.removeAttribute("data-theme"):e.setAttribute("data-theme",t))}function gl(t="system"){let e=y(t);return Et(t),{theme:()=>e(),setTheme(a){e.set(a),Et(a)},toggle(){let a=e()==="dark"?"light":"dark";e.set(a),Et(a)}}}function kl(t){return i`<div class=${`dx-alert is-${t.tone??"info"}`} role=${t.tone==="neg"?"alert":"status"}>
    ${t.icon?i`<span class="dx-alert-ico" aria-hidden="true">${t.icon}</span>`:""}
    <div class="dx-alert-body">
      ${t.title?i`<div class="dx-alert-title">${t.title}</div>`:""}
      ${t.body?i`<div class="dx-alert-text">${()=>$(t.body)}</div>`:""}
    </div>
    ${t.onDismiss?i`<button class="dx-alert-x" aria-label="Dismiss" @click=${()=>t.onDismiss()}>×</button>`:""}
  </div>`}function wl(t){let e=t.title?H("dx-modal"):"",a=s=>{s.key==="Escape"&&t.onClose?.()};return i`<div
    class=${C("dx-modal-backdrop",t.size&&`is-${t.size}`)}
    ?hidden=${()=>!$(t.open)}
    @click=${s=>{s.target===s.currentTarget&&t.onClose?.()}}
    @keydown=${a}
  >
    <div class="dx-modal" role="dialog" aria-modal="true" aria-labelledby=${e||!1}>
      ${t.title?i`<div class="dx-modal-head"><h2 class="dx-modal-title" id=${e}>${t.title}</h2><button class="dx-modal-x" aria-label="Close" @click=${()=>t.onClose?.()}>×</button></div>`:""}
      <div class="dx-modal-body">${()=>$(t.body)}</div>
      ${t.footer?i`<div class="dx-modal-foot">${()=>$(t.footer)}</div>`:""}
    </div>
  </div>`}function Cl(t){let e=H("dx-tip");return i`<span class=${C("dx-tip-wrap",`is-${t.placement??"top"}`)} tabindex="0" aria-describedby=${e}>
    ${t.children}<span class="dx-tip" role="tooltip" id=${e}>${t.tip}</span>
  </span>`}function Tl(t={}){let e=t.kind??"line";if(e==="line"){let a=t.lines??3;return i`<div class="dx-skel-lines" aria-hidden="true">${Array.from({length:a},()=>i`<span class="dx-skel dx-skel-line"></span>`)}</div>`}return i`<span class=${`dx-skel dx-skel-${e}`} aria-hidden="true"></span>`}function Dl(t="Loading"){return i`<span class="dx-spinner" role="status" aria-label=${t}></span>`}function Sl(t){let e=t.max??100;return i`<div class="dx-progress-row">
    <progress class=${C("dx-progress",t.tone&&`is-${t.tone}`)} max=${e} value=${()=>$(t.value)}></progress>
    ${t.showValue?i`<span class="dx-progress-val">${()=>Math.round($(t.value)/e*100)}%</span>`:""}
  </div>`}function Ml(t){let e=()=>Math.max(0,Math.min(1,$(t.value)))*100;return i`<div class=${C("dx-meter",t.tone&&`is-${t.tone}`)} role="progressbar" aria-label=${t.label??!1}>
    <svg class="dx-meter-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
      <rect class="dx-meter-bg" x="0" y="0" width="100" height="6" rx="3"></rect>
      <rect class="dx-meter-fill" x="0" y="0" width=${()=>e()} height="6" rx="3"></rect>
    </svg>
  </div>`}function Al(t){return i`<div class="dx-empty">
    ${t.icon?i`<div class="dx-empty-ico" aria-hidden="true">${t.icon}</div>`:""}
    <div class="dx-empty-title">${t.title}</div>
    ${t.description?i`<p class="dx-empty-desc">${t.description}</p>`:""}
    ${t.action?Ze({label:t.action.label,variant:"primary",onClick:t.action.onClick}):""}
  </div>`}function Ll(t){let e=a=>i`<button
      class=${()=>C("dx-tab",$(t.active)===a.id&&"is-active")}
      role="tab"
      type="button"
      aria-selected=${()=>$(t.active)===a.id?"true":"false"}
      ?disabled=${a.disabled??!1}
      @click=${()=>t.onSelect?.(a.id)}
    >${a.label}${a.count!==void 0?i`<span class="dx-tab-count">${()=>$(a.count)}</span>`:""}</button>`;return i`<div class="dx-tabs" role="tablist" aria-label=${t.ariaLabel??!1}>${S(()=>$(t.tabs),a=>a.id,e)}</div>`}function Rl(t){return i`<div class=${C("dx-seg",t.size==="md"&&"is-md")} role="tablist" aria-label=${t.ariaLabel??!1}>${S(()=>$(t.options),e=>e.value,e=>i`<button
        class=${()=>C("dx-seg-item",$(t.value)===e.value&&"is-active")}
        role="tab"
        type="button"
        aria-selected=${()=>$(t.value)===e.value?"true":"false"}
        @click=${()=>t.onChange?.(e.value)}
      >${e.label}</button>`)}</div>`}function Fl(t){let e=t.length-1;return i`<nav class="dx-crumbs" aria-label="Breadcrumb"><ol>${t.map((a,s)=>i`<li>${s===e||!a.onClick?i`<span class="dx-crumb is-current" aria-current=${s===e?"page":!1}>${a.label}</span>`:i`<button class="dx-crumb dx-link-btn" @click=${()=>a.onClick()}>${a.label}</button>`}${s<e?i`<span class="dx-crumb-sep" aria-hidden="true">/</span>`:""}</li>`)}</ol></nav>`}function Nl(t){let e=s=>i`<button
      class=${()=>C("dx-pnav-item",$(t.active)===s.id&&"is-active")}
      type="button"
      aria-current=${()=>$(t.active)===s.id?"page":!1}
      @click=${()=>t.onSelect?.(s.id)}
    >
      ${s.icon?i`<span class="dx-pnav-ico" aria-hidden="true">${s.icon}</span>`:i`<span class="dx-dot" aria-hidden="true"></span>`}
      <span class="dx-pnav-label">${s.label}</span>
      ${s.badge!==void 0?i`<span class="dx-pnav-badge">${()=>$(s.badge)}</span>`:""}
    </button>`,a=s=>i`<div class="dx-pnav-group">${s.label?i`<div class="dx-pnav-grouplabel">${s.label}</div>`:""}${s.items.map(e)}</div>`;return i`<nav class="dx-pnav" aria-label=${t.ariaLabel??"Navigation"}>${()=>$(t.groups).map(a)}</nav>`}function Ul(t){let e=C("dx-avatar2",t.size&&t.size!=="md"&&`is-${t.size}`);return t.src?i`<img class=${e} src=${t.src} alt=${t.name??""} />`:i`<span class=${e} role="img" aria-label=${t.name??!1}>${t.initials??"?"}</span>`}function jl(t){return t?i`<div class="dx-divider has-label" role="separator"><span>${t}</span></div>`:i`<hr class="dx-divider" />`}function Bl(t){let e=y(!1),a=y(""),s=()=>$(t.options),l=()=>{let c=$(t.value??(t.multiple?[]:""));return Array.isArray(c)?c:c?[c]:[]},r=c=>l().includes(c),n=()=>{let c=a().trim().toLowerCase();return c?s().filter(f=>f.label.toLowerCase().includes(c)):s()},o=c=>s().find(f=>f.value===c)?.label??c,d=c=>{if(t.multiple){let f=r(c)?l().filter(m=>m!==c):[...l(),c];t.onChange?.(f)}else t.onChange?.(c),e.set(!1),a.set("")},p=()=>{let c=l();return c.length===0?i`<span class="dx-s2-ph">${t.placeholder??"Select\u2026"}</span>`:t.multiple?i`<span class="dx-s2-chips">${c.map(f=>i`<span class="dx-s2-chip">${o(f)}<button class="dx-s2-chipx" aria-label=${`Remove ${o(f)}`} @click=${m=>{m.stopPropagation(),d(f)}}>×</button></span>`)}</span>`:o(c[0])};return i`<div
    class=${C("dx-s2",q(t.size),t.multiple&&"is-multi")}
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
      <div class="dx-s2-list">${S(()=>n(),c=>c.value,c=>i`<button
            class=${()=>C("dx-s2-opt",r(c.value)&&"is-selected")}
            role="option"
            type="button"
            aria-selected=${()=>r(c.value)?"true":"false"}
            @click=${()=>d(c.value)}
          ><span class="dx-s2-check" aria-hidden="true">✓</span>${c.label}</button>`)}</div>
      ${()=>n().length===0?i`<div class="dx-s2-empty">No matches</div>`:""}
    </div>
  </div>`}var xa=["January","February","March","April","May","June","July","August","September","October","November","December"],ba=["Su","Mo","Tu","We","Th","Fr","Sa"],ft=t=>String(t).padStart(2,"0"),ga=(t,e,a)=>`${t}-${ft(e+1)}-${ft(a)}`;function Il(t){let e=t.monthNames??xa,a=t.weekdayNames??ba,s=t.weekStart??0,l=a.slice(s).concat(a.slice(0,s)),r=y(!1),n=new Date,o=()=>{let v=$(t.value??""),h=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);return h?{y:+h[1],m:+h[2]-1,d:+h[3]}:null},d=o(),p=y(d?.y??n.getFullYear()),c=y(d?.m??n.getMonth()),f=v=>{let h=c()+v,u=p();h<0?(h=11,u--):h>11&&(h=0,u++),c.set(h),p.set(u)},m=()=>{let v=p(),h=c(),u=(new Date(v,h,1).getDay()-s+7)%7,g=new Date(v,h+1,0).getDate(),T=[];for(let w=0;w<u;w++)T.push(null);for(let w=1;w<=g;w++)T.push(w);return T},k=v=>{let h=o();return!!h&&h.y===p()&&h.m===c()&&h.d===v},D=v=>n.getFullYear()===p()&&n.getMonth()===c()&&n.getDate()===v,b=()=>$(t.value??"")||(t.placeholder??"Pick a date");return i`<div
    class=${C("dx-dp",q(t.size))}
    @focusout=${v=>{let h=v.currentTarget,u=v.relatedTarget;(!u||!h.contains(u))&&r.set(!1)}}
  >
    <button
      class=${()=>C("dx-dp-face",!$(t.value??"")&&"is-empty")}
      type="button"
      aria-haspopup="dialog"
      aria-expanded=${()=>r()?"true":"false"}
      aria-label=${t.ariaLabel??!1}
      @click=${()=>r.set(!r())}
    ><span class="dx-dp-ico" aria-hidden="true">📅</span>${()=>b()}</button>
    <div class="dx-dp-pop" role="dialog" ?hidden=${()=>!r()}>
      <div class="dx-dp-head">
        <button class="dx-btn is-icon" type="button" aria-label="Previous month" @click=${()=>f(-1)}>‹</button>
        <span class="dx-dp-title">${()=>`${e[c()]} ${p()}`}</span>
        <button class="dx-btn is-icon" type="button" aria-label="Next month" @click=${()=>f(1)}>›</button>
      </div>
      <div class="dx-dp-grid dx-dp-dow">${l.map(v=>i`<span class="dx-dp-wd">${v}</span>`)}</div>
      <div class="dx-dp-grid">${()=>m().map(v=>v===null?i`<span class="dx-dp-cell is-empty"></span>`:i`<button
                class=${C("dx-dp-cell",k(v)&&"is-selected",D(v)&&"is-today")}
                type="button"
                aria-pressed=${k(v)?"true":"false"}
                @click=${()=>{t.onChange?.(ga(p(),c(),v)),r.set(!1)}}
              >${v}</button>`)}</div>
    </div>
  </div>`}function ql(t={}){let e=t.seconds??60,a=y(t.mode==="stopwatch"?0:e),s=y(!1),l,r=()=>{s.set(!1),l!==void 0&&clearInterval(l),l=void 0},n=()=>{t.mode==="stopwatch"?a.update(c=>c+1):(a.update(c=>Math.max(0,c-1)),a()<=0&&(r(),t.onComplete?.()))},o=()=>{s()||(t.mode!=="stopwatch"&&a()<=0&&a.set(e),s.set(!0),l=setInterval(n,1e3))},d=()=>{r(),a.set(t.mode==="stopwatch"?0:e)};t.running&&o(),L(r);let p=()=>{let c=a();return`${ft(Math.floor(c/60))}:${ft(c%60)}`};return i`<div class="dx-timer">
    <span class=${()=>C("dx-timer-face",s()&&"is-running",t.mode!=="stopwatch"&&a()<=0&&"is-done")} role="timer" aria-live="off">${()=>p()}</span>
    ${t.controls===!1?"":i`<div class="dx-timer-ctl">
          <button class="dx-btn is-icon" type="button" aria-label="Start" @click=${o}>▶</button>
          <button class="dx-btn is-icon" type="button" aria-label="Pause" @click=${r}>⏸</button>
          <button class="dx-btn is-icon" type="button" aria-label="Reset" @click=${d}>↺</button>
        </div>`}
  </div>`}function ya(t){let e=t.width??100,a=t.height??28,s=1.5,l=()=>{let d=$(t.data);if(d.length===0)return[];let p=Math.min(...d),c=Math.max(...d)-p||1,f=d.length>1?(e-s*2)/(d.length-1):0;return d.map((m,k)=>[s+k*f,a-s-(m-p)/c*(a-s*2)])},r=()=>l().map(([d,p])=>`${d.toFixed(1)},${p.toFixed(1)}`).join(" "),n=()=>{let d=l();if(d.length===0)return"";let p=d[0],c=d[d.length-1];return`${p[0].toFixed(1)},${a} ${r()} ${c[0].toFixed(1)},${a}`},o=()=>{let d=l();return d.length?d[d.length-1]:[0,0]};return i`<svg
    class=${C("dx-spark",t.tone&&`is-${t.tone}`)}
    viewBox=${`0 0 ${e} ${a}`}
    preserveAspectRatio="none"
    role="img"
    aria-label=${t.ariaLabel??!1}
  >${t.fill?i`<polyline class="dx-spark-fill" points=${()=>n()}></polyline>`:""}<polyline
      class="dx-spark-line"
      points=${()=>r()}
    ></polyline>${t.dot?i`<circle class="dx-spark-dot" r="2" cx=${()=>o()[0].toFixed(1)} cy=${()=>o()[1].toFixed(1)}></circle>`:""}</svg>`}var M=t=>t.toISOString().slice(0,10),E=(t,e,a)=>new Date(Date.UTC(t,e-1,a));function ue(t){let e=t%19,a=Math.floor(t/100),s=t%100,l=Math.floor(a/4),r=a%4,n=Math.floor((a+8)/25),o=Math.floor((a-n+1)/3),d=(19*e+a-l-o+15)%30,p=Math.floor(s/4),c=s%4,f=(32+2*r+2*p-d-c)%7,m=Math.floor((e+11*d+22*f)/451),k=Math.floor((d+f-7*m+114)/31),D=(d+f-7*m+114)%31+1;return E(t,k,D)}var J=(t,e)=>new Date(ue(t).getTime()+e*864e5);function Hl(t,e,a,s){let l=E(t,e,1),r=(a-l.getUTCDay()+7)%7;return E(t,e,1+r+(s-1)*7)}var ut={"pt-AO":t=>[{date:M(E(t,1,1)),name:"Ano Novo",type:"public"},{date:M(E(t,2,4)),name:"Dia do In\xEDcio da Luta Armada",type:"public"},{date:M(J(t,-47)),name:"Ter\xE7a-feira de Carnaval",type:"public"},{date:M(E(t,3,8)),name:"Dia Internacional da Mulher",type:"public"},{date:M(E(t,3,23)),name:"Dia da Liberta\xE7\xE3o da \xC1frica Austral",type:"public"},{date:M(J(t,-2)),name:"Sexta-feira Santa",type:"public"},{date:M(E(t,4,4)),name:"Dia da Paz e Reconcilia\xE7\xE3o Nacional",type:"public"},{date:M(E(t,5,1)),name:"Dia do Trabalhador",type:"public"},{date:M(E(t,9,17)),name:"Dia do Fundador da Na\xE7\xE3o e do Her\xF3i Nacional",type:"public"},{date:M(E(t,11,2)),name:"Dia dos Finados",type:"public"},{date:M(E(t,11,11)),name:"Dia da Independ\xEAncia Nacional",type:"public"},{date:M(E(t,12,25)),name:"Dia de Natal e da Fam\xEDlia",type:"public"}],en:t=>[{date:M(E(t,1,1)),name:"New Year's Day",type:"public"},{date:M(J(t,-2)),name:"Good Friday",type:"public"},{date:M(J(t,1)),name:"Easter Monday",type:"public"},{date:M(E(t,5,1)),name:"Labour Day",type:"public"},{date:M(E(t,12,25)),name:"Christmas Day",type:"public"},{date:M(E(t,12,26)),name:"Boxing Day",type:"public"}],"pt-PT":t=>[{date:M(E(t,1,1)),name:"Ano Novo",type:"public"},{date:M(J(t,-47)),name:"Carnaval",type:"observance"},{date:M(J(t,-2)),name:"Sexta-feira Santa",type:"public"},{date:M(ue(t)),name:"P\xE1scoa",type:"public"},{date:M(E(t,4,25)),name:"Dia da Liberdade",type:"public"},{date:M(E(t,5,1)),name:"Dia do Trabalhador",type:"public"},{date:M(E(t,6,10)),name:"Dia de Portugal",type:"public"},{date:M(E(t,12,25)),name:"Natal",type:"public"}]};function _l(t,e){ut[t]=e}function pe(t,e){let a=t.split("-")[0],s=ut[t]??ut[a]??ut.en;return s?s(e):[]}function Wl(t,e){let a=new Map;for(let s of e)for(let l of pe(t,s))a.has(l.date)||a.set(l.date,l);return a}var Ut=t=>String(t).padStart(2,"0"),Lt=(t,e,a)=>`${t}-${Ut(e+1)}-${Ut(a)}`,ka=(t,e,a)=>new Date(Date.UTC(t,e,a)).getUTCDay(),wa=(t,e)=>new Date(Date.UTC(t,e+1,0)).getUTCDate();function Ca(t,e){let a=new Intl.DateTimeFormat(t,{weekday:"short",timeZone:"UTC"}),s=Array.from({length:7},(l,r)=>a.format(new Date(Date.UTC(1970,0,4+r))));return s.slice(e).concat(s.slice(0,e))}function Vl(t){let e=t.locale??"pt-AO",a=t.weekStart??0,s=new Date,l=Lt(s.getUTCFullYear(),s.getUTCMonth(),s.getUTCDate()),r=()=>{let h=$(t.value??""),u=/^(\d{4})-(\d{2})/.exec(h);return u?[+u[1],+u[2]-1]:[s.getUTCFullYear(),s.getUTCMonth()]},[n,o]=r(),d=y(n),p=y(o),c=h=>{let u=p()+h,g=d();u<0?(u=11,g--):u>11&&(u=0,g++),p.set(u),d.set(g),t.onMonthChange?.(`${g}-${Ut(u+1)}`)},f=()=>{if(!t.holidays)return new Map;let h=typeof t.holidays=="function"?t.holidays(d()):pe(e,d()),u=new Map;for(let g of h)u.set(g.date,g);return u},m=()=>{let h=new Map;for(let u of $(t.events??[]))(h.get(u.date)??h.set(u.date,[]).get(u.date)).push(u);return h},k=new Intl.DateTimeFormat(e,{month:"long",year:"numeric",timeZone:"UTC"}),D=Ca(e,a),b=()=>{let h=d(),u=p(),g=(ka(h,u,1)-a+7)%7,T=[];for(let w=0;w<g;w++)T.push(null);for(let w=1;w<=wa(h,u);w++)T.push(w);return T},v=h=>{if(h===null)return i`<div class="dx-cal-cell is-empty"></div>`;let u=Lt(d(),p(),h),g=f().get(u),T=m().get(u)??[];return i`<button
      class=${()=>C("dx-cal-cell",$(t.value??"")===u&&"is-selected",u===l&&"is-today",g&&"is-holiday")}
      type="button"
      aria-current=${u===l?"date":!1}
      aria-pressed=${()=>$(t.value??"")===u?"true":"false"}
      title=${g?g.name:!1}
      @click=${()=>t.onSelect?.(u)}
    >
      <span class="dx-cal-num">${String(h)}</span>
      ${g?i`<span class="dx-cal-holi" aria-hidden="true"></span>`:""}
      ${T.length?i`<span class="dx-cal-evs" aria-hidden="true">${T.slice(0,3).map(w=>i`<span class=${C("dx-cal-ev",w.tone&&`is-${w.tone}`)}></span>`)}</span>`:""}
    </button>`};return i`<div class=${C("dx-cal",q(t.size))}>
    <div class="dx-cal-head">
      <button class="dx-btn is-icon" type="button" aria-label="Previous month" @click=${()=>c(-1)}>‹</button>
      <span class="dx-cal-title">${()=>k.format(new Date(Date.UTC(d(),p(),1)))}</span>
      <button class="dx-btn is-icon" type="button" aria-label="Next month" @click=${()=>c(1)}>›</button>
    </div>
    <div class="dx-cal-grid dx-cal-dow">${D.map(h=>i`<span class="dx-cal-wd">${h}</span>`)}</div>
    <div class="dx-cal-grid">${S(()=>b(),(h,u)=>h===null?`e${u}`:Lt(d(),p(),h),v)}</div>
  </div>`}var Ta=t=>t==="pos"?"\u25B2":t==="neg"?"\u25BC":"";function Da(t){let e=t.tone??"mut",a=C("dx-metric",q(t.size),t.onClick&&"is-clickable"),s=i`<div class="dx-metric-main">
      <div class="dx-metric-label">${t.label}</div>
      <div class="dx-metric-value">${()=>$(t.value)}</div>
      ${t.delta?i`<div class=${`dx-metric-delta is-${e}`}><span class="dx-metric-arrow" aria-hidden="true">${Ta(t.tone)}</span>${()=>$(t.delta)}</div>`:""}
      ${t.hint?i`<div class="dx-metric-hint">${t.hint}</div>`:""}
    </div>${t.trend?i`<div class="dx-metric-trend">${ya({data:t.trend,tone:t.tone,fill:!0})}</div>`:""}`,l=i`${t.icon?i`<div class="dx-metric-icon" aria-hidden="true">${t.icon}</div>`:""}${s}`;return t.onClick?i`<button type="button" class=${a} @click=${t.onClick}>${l}</button>`:i`<div class=${a}>${l}</div>`}function Yl(t){return i`<div class="dx-metrics">${S(t,e=>e.label,Da)}</div>`}function Xl(t){let e=y(!1),a=()=>C("dx-img",q(t.size),t.rounded&&"is-rounded",t.fit==="contain"&&"is-contain",t.ratio&&"has-ratio",e()&&"is-broken");return i`<figure class=${()=>a()} ref=${s=>{t.ratio&&s.style.setProperty("--dx-img-ratio",t.ratio)}}>
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
  </figure>`}function ts(t){let e=C("dx-video",t.ratio&&"has-ratio");return i`<figure class=${e} ref=${a=>{t.ratio&&a.style.setProperty("--dx-img-ratio",t.ratio)}}>
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
  </figure>`}function es(t){let e=y(0),a=y(!1),s=()=>$(t.slides).length,l=d=>{let p=s();p>0&&e.set((d%p+p)%p)},r=()=>l(e()+1),n=()=>l(e()-1);if(t.autoplayMs&&t.autoplayMs>0){let d=setInterval(()=>{a()||r()},t.autoplayMs);L(()=>clearInterval(d))}let o=d=>{d.key==="ArrowRight"?(r(),d.preventDefault()):d.key==="ArrowLeft"&&(n(),d.preventDefault())};return i`<div
    class="dx-carousel"
    role="region"
    aria-roledescription="carousel"
    aria-label=${t.ariaLabel??"Carousel"}
    tabindex="0"
    @keydown=${o}
    @pointerenter=${()=>a.set(!0)}
    @pointerleave=${()=>a.set(!1)}
  >
    <div class="dx-carousel-track">${S(()=>$(t.slides),(d,p)=>p,(d,p)=>i`<div
          class="dx-carousel-slide"
          role="group"
          aria-roledescription="slide"
          ?hidden=${()=>e()!==p}
        >${d}</div>`)}</div>
    ${t.showArrows===!1?"":i`<button class="dx-carousel-arrow is-prev" type="button" aria-label="Previous slide" @click=${n}>‹</button>
          <button class="dx-carousel-arrow is-next" type="button" aria-label="Next slide" @click=${r}>›</button>`}
    ${t.showDots===!1?"":i`<div class="dx-carousel-dots" role="tablist">${S(()=>$(t.slides),(d,p)=>p,(d,p)=>i`<button
              class=${()=>C("dx-carousel-dot",e()===p&&"is-active")}
              type="button"
              role="tab"
              aria-label=${`Slide ${p+1}`}
              aria-selected=${()=>e()===p?"true":"false"}
              @click=${()=>l(p)}
            ></button>`)}</div>`}
  </div>`}var Rt=360,Ft=180;function Nt(t,e){return[t+180,90-e]}function ls(t){let e=t.width??360,a=t.height??180,s=t.graticule??!0,l=[];for(let n=-180;n<=180;n+=30)l.push(n);let r=[];for(let n=-90;n<=90;n+=30)r.push(n);return i`<svg
    class="dx-map"
    viewBox=${`0 0 ${Rt} ${Ft}`}
    width=${e}
    height=${a}
    role="img"
    aria-label=${t.ariaLabel??!1}
  ><rect class="dx-map-ocean" x="0" y="0" width=${Rt} height=${Ft}></rect>${s?i`<g class="dx-map-grid" aria-hidden="true">${l.map(n=>{let o=Nt(n,0)[0];return i`<line class="dx-map-line" x1=${o} y1="0" x2=${o} y2=${Ft}></line>`})}${r.map(n=>{let o=Nt(0,n)[1];return i`<line class="dx-map-line" x1="0" y1=${o} x2=${Rt} y2=${o}></line>`})}</g>`:""}<g class="dx-map-markers">${S(()=>$(t.markers??[]),(n,o)=>n.label??o,n=>{let[o,d]=Nt(n.lon,n.lat);return i`<circle
        class=${C("dx-map-pin",n.tone&&`is-${n.tone}`)}
        r="3"
        cx=${o.toFixed(2)}
        cy=${d.toFixed(2)}
      >${n.label?i`<title>${n.label}</title>`:""}</circle>`})}</g></svg>`}var re="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";function Sa(t,e){return t>=e?"full":t>=e-.5?"half":"empty"}function rs(t){let e=t.max??5,a=t.allowHalf??!1,s=a?.5:1,l=typeof t.onChange=="function",r=Array.from({length:e},(c,f)=>f+1),n=c=>{let f=Math.max(0,Math.min(e,c));t.onChange?.(f)},o=c=>()=>C("dx-star",`is-${Sa($(t.value),c)}`);if(!l){let c=t.ariaLabel??`${$(t.value)} of ${e} stars`;return i`<span
      class=${C("dx-rating is-readonly",q(t.size))}
      role="img"
      aria-label=${c}
    >${r.map(f=>i`<span class=${o(f)} aria-hidden="true"><svg class="dx-star-svg" viewBox="0 0 24 24"><path d=${re}></path></svg></span>`)}</span>`}let d=c=>{let f=$(t.value);c.key==="ArrowRight"||c.key==="ArrowUp"?(c.preventDefault(),n(f+s)):(c.key==="ArrowLeft"||c.key==="ArrowDown")&&(c.preventDefault(),n(f-s))},p=H("dx-rate");return i`<span
    class=${C("dx-rating",q(t.size))}
    role="radiogroup"
    aria-label=${t.ariaLabel??!1}
    @keydown=${d}
  >${r.map(c=>i`<button
      class=${o(c)}
      type="button"
      role="radio"
      name=${p}
      aria-label=${`${c} ${c===1?"star":"stars"}`}
      aria-checked=${()=>$(t.value)>=c?"true":"false"}
      tabindex=${()=>Math.ceil($(t.value)||1)===c?"0":"-1"}
      @click=${f=>{let m=f.currentTarget.getBoundingClientRect(),k=a&&m.width>0&&f.clientX-m.left<m.width/2;n(k?c-.5:c)}}
    ><svg class="dx-star-svg" viewBox="0 0 24 24" aria-hidden="true"><path d=${re}></path></svg></button>`)}</span>`}var fe=864e5,Ma=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],O=t=>{let[e,a,s]=t.split("-").map(Number);return Math.round(Date.UTC(e??1970,(a??1)-1,s??1)/fe)},Aa=t=>{let e=new Date(Math.round(t)*fe);return`${Ma[e.getUTCMonth()]} ${e.getUTCDate()}`};function Ea(t,e,a,s){let l=O(t),r=O(e)-l||1,n=O(a),o=O(s),d=(n-l)/r*100,p=(o-n)/r*100;return{x:Math.max(0,d),width:Math.max(0,p)}}var et=16;function La(t,e,a){if(e&&a)return[e,a];if(t.length===0)return[e??"1970-01-01",a??"1970-01-02"];let s=t[0].start,l=t[0].end;for(let r of t)O(r.start)<O(s)&&(s=r.start),O(r.end)>O(l)&&(l=r.end);return[e??s,a??l]}function ne(t,e){let a=O(t),s=O(e)-a||1,l=Math.min(s,10),r=[];for(let n=0;n<=l;n++)r.push({pos:n/l*100,label:Aa(a+s*n/l)});return r}function is(t){let e=()=>La($(t.tasks),t.start,t.end),a=r=>{let[n,o]=e(),d=Ea(n,o,r.start,r.end),p=r.progress!=null?Math.max(0,Math.min(100,r.progress)):null;return i`<div class="dx-gantt-row" role="row">
      <div class="dx-gantt-name" role="rowheader" title=${r.label}>${r.label}</div>
      <div class="dx-gantt-cell" role="gridcell">
        <svg class="dx-gantt-track" viewBox=${`0 0 100 ${et}`} preserveAspectRatio="none" role="img" aria-label=${`${r.label}: ${r.start} to ${r.end}`}>
          <rect class=${C("dx-gantt-bar",r.tone&&`is-${r.tone}`)} x=${d.x} y="3" width=${d.width} height=${et-6} rx="2"></rect>
          ${p!=null?i`<rect class="dx-gantt-prog" x=${d.x} y="3" width=${d.width*p/100} height=${et-6} rx="2"></rect>`:""}
        </svg>
      </div>
    </div>`},s=()=>{let r=ne(...e());return i`<svg class="dx-gantt-axis" viewBox=${`0 0 100 ${et}`} preserveAspectRatio="none" aria-hidden="true">${r.map(n=>i`<line class="dx-gantt-tick" x1=${n.pos} y1="0" x2=${n.pos} y2=${et}></line>`)}</svg>`},l=()=>{let r=ne(...e());return i`<div class="dx-gantt-labels">${r.map(n=>i`<span class="dx-gantt-lbl">${n.label}</span>`)}</div>`};return i`<div class="dx-gantt" role="grid" aria-label=${t.ariaLabel??"Timeline"}>
    <div class="dx-gantt-head" role="row">
      <div class="dx-gantt-name dx-gantt-corner" role="columnheader"></div>
      <div class="dx-gantt-cell" role="columnheader">${()=>s()}${()=>l()}</div>
    </div>
    ${S(()=>$(t.tasks),r=>r.id,a)}
  </div>`}var ie=t=>{let[e,a]=t.split(":").map(Number);return(e??0)*60+(a??0)};function Ra(t,e,a,s){let l=(e-t)*60||1,r=t*60,n=ie(a)-r,o=ie(s)-r;return{top:n/l*100,height:(o-n)/l*100}}var Fa=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],Na=t=>t<10?`0${t}`:`${t}`;function ds(t){let e=t.startHour??7,a=t.endHour??19,s=t.dayLabels??Fa,l=t.weekStart===1?[1,2,3,4,5,6,0]:[0,1,2,3,4,5,6],r=[];for(let d=e;d<=a;d++)r.push(d);let n=d=>{let p=Ra(e,a,d.start,d.end),c=f=>{let m=f.style;m.setProperty("--dx-ev-top",`${p.top}%`),m.setProperty("--dx-ev-height",`${p.height}%`)};return i`<button
      class=${C("dx-plan-ev",d.tone&&`is-${d.tone}`)}
      ref=${c}
      @click=${()=>t.onSelect?.(d.id)}
    >
      <span class="dx-plan-ev-time">${d.start}–${d.end}</span>
      <span class="dx-plan-ev-title">${d.title}</span>
    </button>`},o=d=>i`<div class="dx-plan-col" role="gridcell" data-day=${d}>
      ${r.map(()=>i`<div class="dx-plan-slot" aria-hidden="true"></div>`)}
      ${S(()=>$(t.events).filter(p=>p.day===d),p=>p.id,n)}
    </div>`;return i`<div class="dx-plan" role="grid" aria-label="Weekly agenda">
    <div class="dx-plan-head" role="row">
      <div class="dx-plan-gutter-head" role="columnheader"></div>
      ${l.map(d=>i`<div class="dx-plan-col-head" role="columnheader">${s[d]}</div>`)}
    </div>
    <div class="dx-plan-body">
      <div class="dx-plan-gutter">
        ${r.map(d=>i`<div class="dx-plan-hour">${Na(d)}:00</div>`)}
      </div>
      ${l.map(o)}
    </div>
  </div>`}function ps(t,e,a){if(e.length===0)return!0;let s=new Map;for(let l of e)(s.get(l.field)??s.set(l.field,[]).get(l.field)).push(l.value.toLowerCase());for(let[l,r]of s){let n=String(a(t,l)??"").toLowerCase();if(!r.some(o=>n.includes(o)))return!1}return!0}function fs(t){let e=y(""),a=y([]),s=y([]),l=y([]),r=y("none"),n=y(!1),o=null,d=()=>t.onChange?.({facets:a(),filters:s(),groupBy:l()}),p=b=>{let v=e().trim();v&&(a.set([...a(),{field:b.key,label:b.label,value:v}]),e.set(""),n.set(!1),d())},c=b=>{a.set(a().filter((v,h)=>h!==b)),d()},f=(b,v)=>{b.set(b().includes(v)?b().filter(h=>h!==v):[...b(),v]),d()},m=b=>{b.key==="Enter"?(b.preventDefault(),e().trim()&&p(t.fields[0])):b.key==="Backspace"&&e()===""&&a().length?c(a().length-1):b.key==="Escape"&&(n.set(!1),r.set("none"))};if(t.hotkey!==!1){let b=globalThis.document;if(b){let v=h=>{(h.ctrlKey||h.metaKey)&&(h.key==="k"||h.key==="K")&&(h.preventDefault(),o?.focus())};b.addEventListener("keydown",v),L(()=>b.removeEventListener("keydown",v))}}let k=(b,v)=>i`<span class="dx-sf-facet"><span class="dx-sf-facet-field">${b.label}</span>${b.value}<button class="dx-sf-facet-x" type="button" aria-label=${`Remove ${b.label}: ${b.value}`} @click=${()=>c(v)}>×</button></span>`,D=(b,v,h,u)=>i`
    <div class="dx-sf-menu">
      <button class="dx-sf-mbtn" type="button" aria-haspopup="menu" aria-expanded=${()=>r()===b?"true":"false"} @click=${()=>r.set(r()===b?"none":b)}>${v}<span class="dx-s2-caret" aria-hidden="true">▾</span></button>
      <div class="dx-sf-mlist" role="menu" ?hidden=${()=>r()!==b}>${h.map(g=>i`<button class=${()=>C("dx-sf-mitem",u().includes(g.id)&&"is-on")} role="menuitemcheckbox" type="button" aria-checked=${()=>u().includes(g.id)?"true":"false"} @click=${()=>f(u,g.id)}><span class="dx-sf-check" aria-hidden="true">✓</span>${g.label}</button>`)}</div>
    </div>`;return i`<div
    class="dx-sf"
    @focusout=${b=>{let v=b.currentTarget,h=b.relatedTarget;(!h||!v.contains(h))&&(n.set(!1),r.set("none"))}}
  >
    <div class="dx-sf-box">
      <span class="dx-sf-ico" aria-hidden="true">⌕</span>
      ${S(()=>a(),(b,v)=>`${b.field}:${b.value}:${v}`,k)}
      <input
        class="dx-sf-input"
        type="text"
        role="combobox"
        aria-expanded=${()=>n()?"true":"false"}
        aria-label="Search"
        placeholder=${t.placeholder??"Search\u2026"}
        .value=${()=>e()}
        ref=${b=>o=b}
        @input=${b=>{e.set(b.target.value),n.set(e().length>0)}}
        @focus=${()=>n.set(e().length>0)}
        @keydown=${m}
      />
      <kbd class="dx-sf-kbd" aria-hidden="true">⌘K</kbd>
    </div>
    ${t.filters?.length?D("filters","Filters",t.filters,s):""}
    ${t.groupBy?.length?D("groupby","Group By",t.groupBy,l):""}
    <div class="dx-sf-suggest" role="listbox" ?hidden=${()=>!n()}>${()=>e().trim()?t.fields.map(b=>i`<button class="dx-sf-sugg" role="option" type="button" @click=${()=>p(b)}>Search <b>${b.label}</b> for “<span class="dx-sf-q">${()=>e()}</span>”</button>`):""}</div>
  </div>`}function hs(t){let e=y(!1),a=r=>i`<button
      class=${r.active?"dx-nav-item is-active":"dx-nav-item"}
      aria-current=${r.active?"page":!1}
      @click=${()=>{r.onSelect?.(),e.set(!1)}}
    >
      <span class="dx-dot" aria-hidden="true"></span>${r.label}
    </button>`,s=t.user?i`<div class="dx-user"><span class="dx-avatar">${t.user.initials}</span>${t.user.name}</div>`:"",l=t.search?i`<div class="dx-search"><input
        placeholder=${t.search.placeholder??"Search\u2026"}
        aria-label=${t.search.placeholder??"Search"}
        type="search"
        @input=${r=>t.search.onInput?.(r.target.value)}
      /></div>`:t.topbar?i`${()=>$(t.topbar)}`:i`<div class="dx-search"></div>`;return i`<div class=${()=>C("dx-shell",e()&&"is-nav-open")}>
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
        ${l}${s}
      </header>
      <main class="dx-content">${()=>$(t.content)}</main>
    </div>
  </div>`}function Ua(t){let e=`dx-stat-delta is-${t.tone??"mut"}`;return i`<div class="dx-stat">
    <div class="dx-stat-label">${t.label}</div>
    <div class="dx-stat-value">${()=>$(t.value)}</div>
    ${t.delta?i`<div class=${e}>${()=>$(t.delta)}</div>`:""}
  </div>`}function ms(t){return i`<div class="dx-stats">${S(t,e=>e.label,Ua)}</div>`}function $s(t){let e=t.title?H("dx-card"):"";return i`<section class="dx-card" aria-labelledby=${e||!1}>
    ${t.title?i`<div class="dx-card-head"><h2 class="dx-card-title" id=${e}>${t.title}</h2></div>`:""}
    <div class="dx-card-body">${()=>$(t.body)}</div>
  </section>`}function vs(t,e="mut"){return i`<span class=${`dx-pill is-${e}`}>${t}</span>`}var dt=(t,e)=>t.value?t.value(e):e[t.key]??"",oe=t=>{let e=t.align??(t.numeric?"right":null);return e?`dx-ta-${e}`:""};function xs(t){let e=y(""),a=y(null),s=y(!1),l=y(0),r=t.pageSize??10,n=y(new Set),o=t.debounce??150,d=x=>{e.set(x),l.set(0)},p,c=x=>{if(o<=0){d(x);return}p&&clearTimeout(p),p=setTimeout(()=>d(x),o)},f=P(()=>{let x=e().trim().toLowerCase(),A=$(t.rows);return x?A.filter(N=>t.columns.some(F=>String(dt(F,N)).toLowerCase().includes(x))):A}),m=P(()=>{let x=a(),A=f();if(!x)return A;let N=t.columns.find(Q=>Q.key===x);if(!N)return A;let F=s()?-1:1;return[...A].sort((Q,X)=>{let $t=dt(N,Q),vt=dt(N,X);return typeof $t=="number"&&typeof vt=="number"?($t-vt)*F:String($t).localeCompare(String(vt))*F})}),k=P(()=>m().length),D=P(()=>Math.max(1,Math.ceil(k()/r))),b=P(()=>{let x=Math.min(l(),D()-1);return m().slice(x*r,x*r+r)}),v=x=>{x.sortable&&(a()===x.key?s.set(!s()):(a.set(x.key),s.set(!1)),l.set(0))},h=x=>{let A=C(x.sortable&&"is-sortable",oe(x)),N=()=>a()===x.key?s()?"\u25BC":"\u25B2":"",F=()=>x.sortable?a()===x.key?s()?"descending":"ascending":"none":!1,Q=X=>{x.sortable&&(X.key==="Enter"||X.key===" ")&&(X.preventDefault(),v(x))};return i`<th
      class=${A}
      aria-sort=${F}
      tabindex=${x.sortable?"0":!1}
      @click=${()=>v(x)}
      @keydown=${Q}
    >${x.label}<span class="dx-arrow" aria-hidden="true">${N}</span></th>`},u=x=>{n.set(x),t.onSelectionChange?.([...x])},g=(x,A)=>{let N=new Set(n());A?N.add(x):N.delete(x),u(N)},T=()=>b().map(x=>t.rowKey(x)),w=()=>{let x=T();return x.length>0&&x.every(A=>n().has(A))},R=x=>{let A=new Set(n());for(let N of T())x?A.add(N):A.delete(N);u(A)},_=(x,A)=>i`<td class=${C(x.numeric&&"dx-num",oe(x))}>${x.render?x.render(A):String(dt(x,A))}</td>`,Y=x=>{let A=t.rowKey(x),N=t.onRow?F=>{(F.key==="Enter"||F.key===" ")&&(F.preventDefault(),t.onRow(x))}:void 0;return i`<tr
      class=${()=>C(t.selectable&&n().has(A)&&"is-selected",t.onRow&&"is-click")}
      tabindex=${t.onRow?"0":!1}
      @click=${t.onRow?()=>t.onRow(x):void 0}
      @keydown=${N}
    >${t.selectable?i`<td class="dx-tbl-sel" @click=${F=>F.stopPropagation()}>${pt({checked:()=>n().has(A),onChange:F=>g(A,F)})}</td>`:""}${S(t.columns,F=>F.key,F=>_(F,x))}</tr>`},Z=()=>t.columns.length+(t.selectable?1:0),he=()=>{let x=Math.min(r,5);return i`${Array.from({length:x},()=>i`<tr class="dx-tbl-skel" aria-hidden="true">${Array.from({length:Z()},()=>i`<td><span class="dx-skel dx-skel-line"></span></td>`)}</tr>`)}`},mt=()=>$(t.loading??!1),zt=()=>k()===0?0:Math.min(l(),D()-1)*r+1,me=()=>Math.min(zt()+r-1,k());return i`<section class="dx-card">
    ${t.title?i`<div class="dx-card-head"><h2 class="dx-card-title">${t.title}</h2></div>`:""}
    <div class="dx-tbl-toolbar">
      ${t.search===!1?"":i`<div class="dx-tbl-search"><input
            placeholder="Search…"
            aria-label=${t.title?`Search ${t.title}`:"Search records"}
            type="search"
            @input=${x=>c(x.target.value)}
          /></div>`}
      <div class="dx-spacer"></div>
      ${t.toolbar??""}
      ${t.exportable?ce({rows:()=>m(),columns:t.columns.map(x=>({key:x.key,label:x.label,value:x.value})),filename:(t.exportable===!0?void 0:t.exportable.filename)??(t.title?t.title.toLowerCase().replace(/\s+/g,"-"):"export"),formats:t.exportable===!0?void 0:t.exportable.formats}):""}
    </div>
    <div class="dx-tbl-wrap">
      <table class=${C("dx-tbl",t.density==="compact"&&"is-compact",t.striped&&"is-striped",t.stickyHeader&&"is-sticky")} aria-label=${t.title??"Data table"}>
        <thead><tr>${t.selectable?i`<th class="dx-tbl-sel">${pt({checked:()=>w(),onChange:x=>R(x)})}</th>`:""}${S(t.columns,x=>x.key,h)}</tr></thead>
        <tbody>${()=>mt()?he():""}${S(()=>mt()?[]:b(),x=>t.rowKey(x),Y)}</tbody>
      </table>
    </div>
    ${()=>!mt()&&k()===0?i`<div class="dx-tbl-empty" role="status">No records match your filter.</div>`:""}
    <div class="dx-tbl-foot">
      <span aria-live="polite">Showing ${zt} – ${me} of ${k}</span>
      <div class="dx-spacer"></div>
      <button class="dx-btn" aria-label="Previous page" ?disabled=${()=>l()<=0} @click=${()=>l.set(Math.max(0,l()-1))}>‹ Prev</button>
      <span>Page ${()=>Math.min(l(),D()-1)+1} / ${D}</span>
      <button class="dx-btn" aria-label="Next page" ?disabled=${()=>l()>=D()-1} @click=${()=>l.set(Math.min(D()-1,l()+1))}>Next ›</button>
    </div>
  </section>`}function at(t){return typeof t=="string"?t:JSON.stringify(t,(e,a)=>a&&typeof a=="object"&&!Array.isArray(a)?{o:Object.keys(a).sort().map(s=>[s,a[s]])}:a)}var ht=()=>typeof Date<"u"?Date.now():0;function ys(){let t=new Map,e=(l,r,n,o)=>{let d=t.get(l);return d?(d.fetcher=r,d.staleTime=n):(d={key:l,data:y(o),error:y(void 0),isFetching:y(!1),hasData:y(o!==void 0),fetcher:r,promise:null,updatedAt:o!==void 0?ht():0,observers:0,staleTime:n},t.set(l,d)),d},a=l=>{if(l.promise)return l.promise;I(()=>l.isFetching.set(!0));let r=l.fetcher().then(n=>{I(()=>{l.data.set(n),l.hasData.set(!0),l.error.set(void 0),l.updatedAt=ht()})},n=>{I(()=>l.error.set(n))}).finally(()=>{l.promise=null,I(()=>l.isFetching.set(!1))});return l.promise=r,r},s=l=>l.updatedAt===0||ht()-l.updatedAt>=l.staleTime;return{async invalidate(l){let r=at(l),n=[];for(let o of t.values())ja(o.key,r)&&(o.updatedAt=0,o.observers>0&&n.push(a(o)));await Promise.all(n)},async prefetch(l,r,n={}){let o=e(at(l),r,n.staleTime??0,n.initialData);s(o)&&await a(o)},getData(l){let r=t.get(at(l));return r?I(()=>r.data()):void 0},setData(l,r){let n=at(l),o=t.get(n);o&&I(()=>{o.data.set(r),o.hasData.set(!0),o.updatedAt=ht()})},clear(){t.clear()},_query(l,r,n={}){let o=e(at(l),r,n.staleTime??0,n.initialData);o.observers++,L(()=>{o.observers--}),s(o)&&a(o);let d=(()=>o.data());return d.data=()=>o.data(),d.error=()=>o.error(),d.isFetching=()=>o.isFetching(),d.isLoading=()=>o.isFetching()&&!o.hasData(),d.refetch=()=>(o.updatedAt=0,a(o)),d}}}function ja(t,e){if(e.endsWith("]")){let a=e.slice(0,-1);return t===e||t.startsWith(a+",")||t===a+"]"}return t===e}function ks(t,e,a,s){return t._query(e,a,s)}function Ts(t){let e=t.initial,a=y({...e}),s=y({}),l=P(()=>t.validate?t.validate(a()):{}),r=P(()=>Object.keys(l()).length===0),n=P(()=>{let p=a();return Object.keys(e).some(c=>!Object.is(p[c],e[c]))}),o=(p,c)=>{a.update(f=>({...f,[p]:c}))},d=p=>{s.update(c=>c[p]?c:{...c,[p]:!0})};return{values:a,value:p=>()=>a()[p],setValue:o,errors:l,error:p=>()=>l()[p],touched:p=>()=>!!s()[p],dirty:n,isValid:r,field:p=>({value:()=>a()[p],onInput:c=>o(p,c.target.value),onBlur:()=>d(p)}),handleSubmit:p=>c=>{c?.preventDefault?.(),s.set(Object.keys(e).reduce((f,m)=>(f[m]=!0,f),{})),I(()=>r())&&p(I(()=>a()))},reset:()=>{a.set({...e}),s.set({})}}}function Ds(t){return e=>{let a=t.safeParse(e);if(a.success||!a.error)return{};let s={};for(let l of a.error.issues){let r=l.path[0];r!==void 0&&s[r]===void 0&&(s[r]=l.message)}return s}}export{Re as Fragment,Xa as Outlet,kl as alert,hs as appShell,Ul as avatar,nl as badge,Ea as barGeom,Ba as batch,Fl as breadcrumb,Ze as button,rl as buttonGroup,Vl as calendar,$s as card,es as carousel,pt as checkbox,aa as colLetter,tl as component,P as computed,_t as createContext,Ts as createForm,ys as createQueryClient,G as createRoot,Qa as createRouter,gl as createThemeController,xs as dataTable,Il as datePicker,Ja as defineElement,jl as divider,Mt as download,J as easterPlus,ue as easterSunday,j as effect,Al as emptyState,Ha as escape,Ra as eventGeom,ce as exportMenu,pa as exportTable,ol as field,is as gantt,Wl as holidayIndex,pe as holidaysFor,i as html,Xl as image,Wt as inject,Qe as input,Me as isUnsafeProp,Vt as isUrlAttr,_a as jsxElement,at as keyOf,S as list,ps as matchFacets,Ml as meter,Da as metric,Yl as metricGrid,wl as modal,Dt as mount,Nl as navPanel,Hl as nthWeekday,L as onCleanup,Ia as onError,ae as onMount,vs as pill,ds as planner,Sl as progress,Nt as project,kt as provide,ks as query,ul as radioGroup,_l as registerHolidays,te as render,Je as resolveSize,Jt as sanitizeUrl,fs as searchFilter,Bl as searchableSelect,Rl as segmented,dl as select,za as setInspector,y as signal,q as sizeClass,Tl as skeleton,ya as sparkline,Dl as spinner,rs as starRating,Ua as statCard,ms as statGrid,cl as switchToggle,hl as tableList,Ll as tabs,il as textarea,ql as timer,ta as toCsv,ea as toXls,ua as toXlsx,Cl as tooltip,I as untrack,ts as video,xl as virtualList,ma as visibleRange,Pa as withoutInspector,ls as worldMap,Ds as zodValidate};
