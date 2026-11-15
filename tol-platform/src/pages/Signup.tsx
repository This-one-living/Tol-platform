import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { EBONYI_LGAS, NICHES, NICHES_CATEGORIES } from '../data/reference';

type FormState = {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  confirm: string;
  lga: string;
  community: string;
  niche: string;
  category: string;
  other_niche: string;
  interests: string;
  skills: string;
};

const empty: FormState = {
  full_name: '',
  phone: '',
  email: '',
  password: '',
  confirm: '',
  lga: '',
  community: '',
  niche: '',
  category: '',
  other_niche: '',
  interests: '',
  skills: '',
};

export default function Signup() {
  const [f, setF] = useState<FormState>(empty);
  const [communities, setCommunities] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const isOther = f.niche === 'Other';

  useEffect(() => {
    setF((prev) => ({ ...prev, community: '' }));

    if (!f.lga) {
      setCommunities([]);
      return;
    }

    void supabase
      .from('communities')
      .select('name')
      .eq('lga', f.lga)
      .order('name')
      .then(({ data }) => {
        setCommunities((data ?? []).map((c: { name: string }) => c.name));
      });
  }, [f.lga]);

  useEffect(() => {
    setF((prev) => ({ ...prev, category: '' }));

    if (!f.niche || f.niche === 'Other') {
      setCategories([]);
      return;
    }

    const fallbackCategories = NICHES_CATEGORIES[f.niche] ?? [];

    void supabase
      .from('categories')
      .select('name')
      .eq('niche', f.niche)
      .order('name')
      .then(({ data }) => {
        const dbCategories = (data ?? []).map((c: { name: string }) => c.name);
        setCategories(dbCategories.length ? dbCategories : fallbackCategories);
      });
  }, [f.niche]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (f.password.length < 8) {
      return setError('Password must be at least 8 characters.');
    }

    if (f.password !== f.confirm) {
      return setError('Passwords do not match.');
    }

    if (!/^(\+234|0)[789]\d{9}$/.test(f.phone.replace(/\s/g, ''))) {
      return setError('Enter a valid Nigerian phone number.');
    }

    setBusy(true);

    const { data, error: authErr } = await supabase.auth.signUp({
      email: f.email,
      password: f.password,
    });

    if (authErr || !data.user) {
      setBusy(false);
      return setError(authErr?.message ?? 'Could not create the account. Please try again.');
    }

    const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const { error: profErr } = await supabase.from('profiles').insert({
      id: data.user.id,
      full_name: f.full_name,
      phone: f.phone,
      state: 'Ebonyi',
      lga: f.lga,
      community: f.community || 'Other',
      niche: f.niche,
      category: f.category || null,
      other_niche: isOther ? f.other_niche : null,
      interests: list(f.interests),
      skills: list(f.skills),
    });

    setBusy(false);

    if (profErr) {
      return setError(profErr.message);
    }

    window.location.href = '/';
  };

  return (
    <form className="tol-form" onSubmit={submit}>
      <h1>Create your TOL account</h1>
      <p className="muted">No email or SMS verification needed. Your phone and email stay private.</p>

      <label>
        Full name
        <input required value={f.full_name} onChange={set('full_name')} />
      </label>

      <label>
        Phone number
        <input required type="tel" value={f.phone} onChange={set('phone')} />
      </label>

      <label>
        Email
        <input required type="email" value={f.email} onChange={set('email')} />
      </label>

      <div className="row">
        <label>
          Password
          <input required type="password" value={f.password} onChange={set('password')} />
        </label>
        <label>
          Confirm password
          <input required type="password" value={f.confirm} onChange={set('confirm')} />
        </label>
      </div>

      <label>
        State
        <input value="Ebonyi" disabled />
      </label>

      <div className="row">
        <label>
          LGA where you live now
          <select required value={f.lga} onChange={set('lga')}>
            <option value="">Select LGA</option>
            {EBONYI_LGAS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label>
          Community / town
          <select required value={f.community} onChange={set('community')} disabled={!f.lga}>
            <option value="">{f.lga ? 'Select community' : 'Choose an LGA first'}</option>
            {communities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="Other">Other (admin will review)</option>
          </select>
        </label>
      </div>

      <label>
        Major niche
        <select required value={f.niche} onChange={set('niche')}>
          <option value="">Select niche</option>
          {NICHES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      {isOther ? (
        <label>
          Describe your niche
          <input required value={f.other_niche} onChange={set('other_niche')} />
        </label>
      ) : (
        <label>
          Category / specialisation
          <select required={!!f.niche} value={f.category} onChange={set('category')} disabled={!f.niche}>
            <option value="">{f.niche ? 'Select category' : 'Choose a niche first'}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        Interests (comma separated)
        <input value={f.interests} onChange={set('interests')} />
      </label>

      <label>
        Skills (comma separated)
        <input value={f.skills} onChange={set('skills')} />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button className="btn-primary" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
