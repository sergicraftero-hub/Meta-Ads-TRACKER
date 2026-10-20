/**
 * First-party tracking snippet served at /t.js?k=<site key>.
 * - Persists a visitor id in a first-party cookie (survives ITP better than 3rd-party pixels).
 * - Captures fbclid / UTMs / Meta ad ids for attribution and builds _fbc for CAPI matching.
 * - Mirrors every custom event to the browser Meta Pixel with the same eventID so Meta deduplicates.
 * - On Shopify, stores the visitor id as a cart attribute so server-side orders can be attributed.
 * Kept in ES5 so it runs on any storefront without transpiling.
 */
export function trackerScript(endpoint: string, key: string): string {
  return `(function(w,d){
  if (w.adpilot && w.adpilot._loaded) return;
  var K=${JSON.stringify(key)}, E=${JSON.stringify(endpoint)};
  function gc(n){var m=d.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null}
  function rootDomain(){var h=location.hostname.split('.');for(var i=h.length-2;i>=0;i--){var c=h.slice(i).join('.');d.cookie='_apt=1;domain=.'+c+';path=/';if(gc('_apt')){d.cookie='_apt=;domain=.'+c+';path=/;max-age=0';return c}}return location.hostname}
  var RD=rootDomain();
  function sc(n,v,days){d.cookie=n+'='+encodeURIComponent(v)+';domain=.'+RD+';path=/;max-age='+(days*86400)+';SameSite=Lax'+(location.protocol==='https:'?';Secure':'')}
  function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,10)}
  var vid=gc('_apv'); if(!vid){vid=uid()+uid()} sc('_apv',vid,400);
  var q={}; location.search.replace(/[?&]([^=&]+)=([^&]*)/g,function(_,k,v){try{q[decodeURIComponent(k)]=decodeURIComponent(v.replace(/\\+/g,' '))}catch(e){}});
  var P={}; ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','campaign_id','adset_id','ad_id'].forEach(function(k){if(q[k])P[k]=q[k]});
  if(q.fbclid && !gc('_fbc')) sc('_fbc','fb.1.'+Date.now()+'.'+q.fbclid,90);
  function send(name,data,opts){
    data=data||{}; opts=opts||{};
    var eid=data.event_id||(name+'_'+uid());
    var body={k:K,vid:vid,name:name,eid:eid,url:location.href,ref:d.referrer,p:P,fbp:gc('_fbp'),fbc:gc('_fbc'),data:data};
    var s=JSON.stringify(body);
    try{ if(!(navigator.sendBeacon&&navigator.sendBeacon(E,new Blob([s],{type:'text/plain'})))) fetch(E,{method:'POST',body:s,keepalive:true,headers:{'Content-Type':'text/plain'}}) }catch(e){}
    if(name!=='PageView' && opts.pixel!==false && typeof w.fbq==='function'){
      var cd={}; if(data.value!=null)cd.value=data.value; if(data.currency)cd.currency=data.currency; if(data.content_ids)cd.content_ids=data.content_ids;
      try{ w.fbq('track',name,cd,{eventID:eid}) }catch(e){}
    }
    return eid;
  }
  // Auto lead capture: <form data-adpilot-lead> sends a Lead with the hashed-on-server email/phone.
  d.addEventListener('submit',function(ev){
    var f=ev.target; if(!f||!f.hasAttribute||!f.hasAttribute('data-adpilot-lead'))return;
    var em=f.querySelector('input[type=email],input[name*=mail]'), ph=f.querySelector('input[type=tel],input[name*=phone],input[name*=tel]');
    send('Lead',{email:em&&em.value,phone:ph&&ph.value});
  },true);
  // Shopify: tie the cart to this visitor so the order webhook can be attributed.
  if(w.Shopify && !sessionStorage.getItem('_apcart')){
    try{ fetch('/cart/update.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attributes:{_apv:vid}})}); sessionStorage.setItem('_apcart','1') }catch(e){}
  }
  w.adpilot={_loaded:true,vid:vid,track:send};
  send('PageView');
})(window,document);`
}
