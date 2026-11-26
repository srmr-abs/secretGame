'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Fingerprint, Shield } from 'lucide-react';

export default function HomePage() {
  const [pin,setPin]=useState(''); const [name,setName]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function join(event:React.FormEvent){event.preventDefault();setError('');setBusy(true);try{const response=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin,name})});const data=await response.json();if(!response.ok)throw new Error(data.error);window.location.href='/play';}catch(e){setError(e instanceof Error?e.message:'Could not join game.');}finally{setBusy(false);}}
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">⌕</span> THE GREAT SECRET UNLOCK</div><Link href="/admin/login" className="btn btn-ghost"><Shield size={15}/> Admin</Link></header>
    <section className="hero"><div><div className="eyebrow">A team investigation experience</div><h1>The truth is<br/><span>in your hands.</span></h1><p className="hero-copy">Play solo or with up to ten teammates. Solve five puzzles, share the clues, and uncover the one secret word before time runs out.</p><div className="tagline">5 PLAYERS. 5 PUZZLES. 5 CLUES. 1 SECRET WORD. ONE TEAM.</div></div>
      <div className="card join-card"><div className="brand-mark" style={{marginBottom:20}}><Fingerprint size={19}/></div><div className="eyebrow">Your team is waiting</div><h2 style={{fontSize:27,marginTop:8}}>Enter the investigation</h2><p className="muted tiny" style={{lineHeight:1.6,marginTop:8}}>Use the six-digit PIN from your game host. We’ll place you into an available team.</p>
        <form onSubmit={join}><div className="field"><label htmlFor="pin">GAME PIN</label><input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e)=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" className="input pin-input" autoComplete="one-time-code" required/></div><div className="field"><label htmlFor="name">DISPLAY NAME</label><input id="name" value={name} onChange={(e)=>setName(e.target.value.slice(0,24))} placeholder="How teammates will know you" className="input" maxLength={24} required/></div>
          {error&&<div role="alert" className="error-box">{error}</div>}<button className="btn btn-primary btn-block" disabled={busy||pin.length!==6||name.trim().length<2}>{busy?'Joining…':<>Join game <ArrowRight size={16}/></>}</button></form>
      </div></section>
    <footer className="muted tiny" style={{paddingBottom:24}}>Built for curious minds and better teamwork.</footer>
  </main>;
}
