import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EBONYI_LGAS, NICHES, NICHE_CATEGORIES } from '../data/reference';

type FormState = {
  full_name: string; phone: string; email: string; password: string; confirm: string;
  lga: string; community: string; niche: string; category: string; other_niche: string;
  interests: string; skills: string;
};

const empty: FormState = {
  full_name: '', phone: '', email: '', password: '', confirm: '',
  lga: '', community: '', niche: '', category: '', other_niche: '', interests: '', skills: '',
};

export default function Signup() {
  const [f, setF] = useState<FormState>(empty);
  const [communities, setCommunities] = useState<string[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setF((prev) => {
      const next = { ...prev, [k]: value };
      if (k === 'lga') next.community = '';
      if (k === 'niche') next.category = '';
      return next;
    });
    if (k === 'lga') {
      setCommunities([]);
      setError('');
    }
  };
  const isOther = f.niche === 'Other';
  const categories = f.niche && f.niche !== 'Other' ? NICHE_CATEGORIES[f.niche] ?? [] : [];

  const handlePhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoPreview('');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  // When the LGA changes, reset the community and load that LGA's communities
  useEffect(() => {
    if (!f.lga || !supabase) return;

    let active = true;
    void (async () => {
      try {
        const { data, error: communitiesError } = await supabase
          .from('communities').select('name').eq('lga', f.lga).order('name');
        if (communitiesError) throw communitiesError;
        if (active) setCommunities((data ?? []).map((c: { name: string }) => c.name));
      } catch (communitiesError) {
        if (active) setError(communitiesError instanceof Error ? communitiesError.message : 'Could not load communities.');
      }
    })();
    return () => { active = false; };
  }, [f.lga]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (f.password.length < 8) return setError('Password must be at least 8 characters.');
    if (f.password !== f.confirm) return setError('Passwords do not match.');
    if (!/^(\+234|0)[789]\d{9}$/.test(f.phone.replace(/\s/g, ''))) return setError('Enter a valid Nigerian phone number.');

    if (!supabase) {
      localStorage.setItem('tol_user_email', f.email.toLowerCase());
      localStorage.setItem('tol_user_phone', f.phone.replace(/\s+/g, ''));
      localStorage.setItem('tol_user_password', f.password);
      if (photoPreview) {
        localStorage.setItem('tol_profile_photo', photoPreview);
      }
      localStorage.setItem('tol_profile_complete', 'true');
      localStorage.setItem('tol_session', 'true');
      window.location.replace('/home');
      return;
    }

    setBusy(true);
    try {
      const { data, error: authErr } = await supabase.auth.signUp({ email: f.email, password: f.password });
      if (authErr) {
        if (authErr.message.toLowerCase().includes('already registered')) {
          return setError('This email is already registered. Sign in with your existing account instead.');
        }
        return setError(authErr.message);
      }
      if (!data.user) {
        return setError('Could not create the account. Please try again.');
      }
      if (data.user.identities?.length === 0) {
        return setError('This email is already registered. Sign in with your existing account instead.');
      }

      const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
      const { error: profErr } = await supabase.from('profiles').insert({
        id: data.user.id, full_name: f.full_name, phone: f.phone, state: 'Ebonyi',
        lga: f.lga, community: f.community || 'Other',
        niche: f.niche, category: f.category || null, other_niche: isOther ? f.other_niche : null,
        interests: list(f.interests), skills: list(f.skills),
      });
      if (profErr) return setError(profErr.message);

      localStorage.setItem('tol_user_email', f.email.toLowerCase());
      localStorage.setItem('tol_user_phone', f.phone.replace(/\s+/g, ''));
      localStorage.removeItem('tol_user_password');

      if (photoPreview) {
        localStorage.setItem('tol_profile_photo', photoPreview);
      }

      localStorage.setItem('tol_profile_complete', 'true');
      localStorage.setItem('tol_session', 'true');
      window.location.replace('/home');
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : 'Could not create the account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="tol-form" onSubmit={submit}>
      <h1>Create your TOL account</h1>
      <p className="muted">No email or SMS verification needed. Your phone and email stay private.</p>

      <label>Full name<input required value={f.full_name} onChange={set('full_name')} /></label>
      <label>Phone number<input required type="tel" value={f.phone} onChange={set('phone')} /></label>
      <label>Email<input required type="email" value={f.email} onChange={set('email')} /></label>
      <div className="row">
        <label>Password<input required type="password" value={f.password} onChange={set('password')} /></label>
        <label>Confirm password<input required type="password" value={f.confirm} onChange={set('confirm')} /></label>
      </div>

      <label>Profile photo (optional)
        <input type="file" accept="image/*" onChange={handlePhotoChange} />
      </label>
      {photoPreview && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <img
            src={photoPreview}
            alt="Profile preview"
            style={{ width: 110, height: 110, borderRadius: '50%', objectFit: 'cover', border: '2px solid #dfe7f5' }}
          />
        </div>
      )}

      <label>State<input value="Ebonyi" disabled /></label>
      <div className="row">
        <label>LGA where you live now
          <select required value={f.lga} onChange={set('lga')}>
            <option value="">Select LGA</option>
            {EBONYI_LGAS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label>Community / town
          <select required value={f.community} onChange={set('community')} disabled={!f.lga}>
            <option value="">{f.lga ? 'Select community' : 'Choose an LGA first'}</option>
            {communities.map((c) => <option key={c}>{c}</option>)}
            <option value="Other">Other (admin will review)</option>
          </select>
        </label>
      </div>

      <label>Major niche
        <select required value={f.niche} onChange={set('niche')}>
          <option value="">Select niche</option>
          {NICHES.map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
      {isOther ? (
        <label>Describe your niche<input required value={f.other_niche} onChange={set('other_niche')} /></label>
      ) : (
        <label>Category / specialisation
          <select required={!!f.niche} value={f.category} onChange={set('category')} disabled={!f.niche}>
            <option value="">{f.niche ? 'Select category' : 'Choose a niche first'}</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      )}
      <p className="muted">
        You’ll automatically join the General community and groups for your selected niche and LGA.
        You can join other communities from the Communities page.
      </p>
      <label>Interests (comma separated)<input value={f.interests} onChange={set('interests')} /></label>
      <label>Skills (comma separated)<input value={f.skills} onChange={set('skills')} /></label>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      <p className="muted">Already registered? <Link to="/auth">Log in</Link>.</p>
    </form>
  );
}
