'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, ClipboardPaste, Fingerprint, Shield } from 'lucide-react';

export default function HomePage() {
  const [pin,setPin]=useState(''); const [name,setName]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function join(event:React.FormEvent){event.preventDefault();setError('');setBusy(true);try{const response=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin,name})});const data=await response.json();if(!response.ok)throw new Error(data.error);window.location.href='/play';}catch(e){setError(e instanceof Error?e.message:'Could not join game.');}finally{setBusy(false);}}
  async function pastePin(){try{const text=await navigator.clipboard.readText();const digits=text.replace(/\D/g,'').slice(0,6);if(digits.length!==6)throw new Error('Clipboard does not contain a six-digit game PIN.');setPin(digits);setError('');}catch(e){setError(e instanceof Error&&e.message.includes('six-digit')?e.message:'Clipboard access was blocked. Focus the PIN field and use your device’s Paste command, or type the six-digit PIN.');}}
  function handlePinPaste(event:React.ClipboardEvent<HTMLInputElement>){event.preventDefault();const digits=event.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);if(digits.length!==6){setError('Paste a six-digit game PIN.');return;}setPin(digits);setError('');}
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">⌕</span> THE GREAT SECRET UNLOCK</div><Link href="/admin/login" className="btn btn-ghost"><Shield size={15}/> Admin</Link></header>
    <section className="hero"><div><div className="eyebrow">A team investigation experience</div><h1>The truth is<br/><span>in your hands.</span></h1><p className="hero-copy">Play solo or join a team of two to ten. Each teammate solves one puzzle and receives a private clue fragment. Combine every fragment to uncover the secret word before time runs out.</p><div className="tagline">ONE PUZZLE PER TEAMMATE. ONE PRIVATE FRAGMENT EACH. ONE SECRET WORD.</div></div>
      <div className="card join-card"><div className="brand-mark" style={{marginBottom:20}}><Fingerprint size={19}/></div><div className="eyebrow">Your team is waiting</div><h2 style={{fontSize:27,marginTop:8}}>Enter the investigation</h2><p className="muted tiny" style={{lineHeight:1.6,marginTop:8}}>Use the six-digit PIN from your game host. We’ll place you into an available team. Each player needs a separate browser profile or device—tabs in the same profile share one player session.</p>
        <form onSubmit={join}><div className="field"><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><label htmlFor="pin">GAME PIN</label><button type="button" className="btn btn-ghost" onClick={()=>void pastePin()} style={{padding:'5px 9px',fontSize:11}}><ClipboardPaste size={14}/> Paste PIN</button></div><input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e)=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} onPaste={handlePinPaste} placeholder="000000" className="input pin-input" autoComplete="one-time-code" required/></div><div className="field"><label htmlFor="name">DISPLAY NAME</label><input id="name" value={name} onChange={(e)=>setName(e.target.value.slice(0,24))} placeholder="How teammates will know you" className="input" maxLength={24} required/></div>
          {error&&<div role="alert" className="error-box">{error}</div>}<button className="btn btn-primary btn-block" disabled={busy||pin.length!==6||name.trim().length<2}>{busy?'Joining…':<>Join game <ArrowRight size={16}/></>}</button></form>
      </div></section>
    <footer className="muted tiny" style={{paddingBottom:24}}>Built for curious minds and better teamwork.</footer>
  </main>;
}
