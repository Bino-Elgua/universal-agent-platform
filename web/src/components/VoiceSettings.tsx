import { useEffect, useState } from 'react';
import type { Bot } from '@shared/types';
import { useStore } from '../store';
import { voiceApi, type VoiceOptions } from '../voice/api';
import { isProviderConfigured, providerRecovery } from '../lib/providers';
import { endCall, isCallActive, previewVoice, startCall, useVoice } from '../voice/call';
import { Icon } from './Icon';

const speedLabel = (s: number) => `${Number(s.toFixed(2))}x`;

function NativeSelect<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const selected = options.find((o) => o.value === value);
  return (
    <span className="mini-select mini-select--native">
      <span>{selected?.label ?? `${value} (unavailable)`}</span>
      <Icon name="chev_down" size={10} opacity={0.66} />
      <select aria-label={label} value={String(value)} onChange={(e) => {
        const option = options.find((o) => String(o.value) === e.target.value);
        if (option) onChange(option.value);
      }}>
        {!selected && <option value={String(value)} disabled>{value} (unavailable)</option>}
        {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </span>
  );
}

/** Real provider options only. Configuration alone does not establish provider health. */
export function VoiceSettings({ bot }: { bot: Bot }) {
  const configured = useStore((s) => isProviderConfigured(s.providers, 'xai'));
  const [opts, setOpts] = useState<VoiceOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inCall = useVoice((s) => isCallActive(s) && s.botId === bot.id);

  useEffect(() => {
    if (!configured) { setOpts(null); setLoading(false); return; }
    let alive = true;
    setLoading(true); setOptionsError(null); setOpts(null);
    voiceApi.options().then((options) => {
      if (!options.voices.length || !options.languages.length || !options.speeds.length) throw new Error('The provider returned no usable voice options.');
      if (alive) setOpts(options);
    }).catch((failure: unknown) => {
      if (alive) setOptionsError(failure instanceof Error ? failure.message : 'Voice options could not be loaded.');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [configured, attempt]);
  useEffect(() => setError(null), [bot.id]);

  const save = async (patch: Partial<Pick<Bot, 'voice' | 'voiceSpeed' | 'voiceLanguage'>>) => {
    const prev = useStore.getState().bots.find((b) => b.id === bot.id);
    useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === bot.id ? { ...b, ...patch } : b)) }));
    setError(null);
    try {
      const res = await fetch(`/api/bots/${bot.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      if (prev) useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === bot.id ? { ...b, voice: prev.voice, voiceSpeed: prev.voiceSpeed, voiceLanguage: prev.voiceLanguage } : b)) }));
      setError('Couldn’t save that setting.');
    }
  };

  const preview = async () => {
    if (previewing || !configured || !opts) return;
    setPreviewing(true); setError(null);
    try { await previewVoice({ botId: bot.id, voice: bot.voice, speed: bot.voiceSpeed, language: bot.voiceLanguage }); }
    catch (failure) { setError((failure as Error).message || 'Preview unavailable'); }
    finally { setPreviewing(false); }
  };
  const selectionValid = opts?.voices.some((v) => v.id === bot.voice) && opts.speeds.includes(bot.voiceSpeed) && opts.languages.some((language) => language.code === bot.voiceLanguage);

  return (
    <div className="panel-card">
      {!configured ? <p className="voice-error" role="status">{providerRecovery.xai}</p> : loading ? <p className="voice-error" role="status">Loading voice options…</p> : optionsError ? (
        <div className="voice-error" role="alert">Couldn’t load voice options. {optionsError} <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>Retry voice options</button></div>
      ) : opts ? <>
        <div className="panel-row panel-row--setting">
          <span>Voice</span>
          <span className="voice-setting__right">
            <button type="button" className="voice-preview" onClick={preview} disabled={previewing || !selectionValid} title={`Hear ${bot.name}'s voice`}>{previewing ? 'Playing…' : 'Preview'}</button>
            <NativeSelect label="Voice" value={bot.voice} options={opts.voices.map((v) => ({ value: v.id, label: v.name }))} onChange={(voice) => save({ voice })} />
          </span>
        </div>
        <div className="panel-row panel-row--setting"><span>Speed</span><NativeSelect label="Speed" value={bot.voiceSpeed} options={opts.speeds.map((speed) => ({ value: speed, label: speedLabel(speed) }))} onChange={(voiceSpeed) => save({ voiceSpeed })} /></div>
        <div className="panel-row panel-row--setting"><span>Language</span><NativeSelect label="Language" value={bot.voiceLanguage} options={opts.languages.map((language) => ({ value: language.code, label: language.name }))} onChange={(voiceLanguage) => save({ voiceLanguage })} /></div>
        {!selectionValid && <p className="voice-error">Choose an available voice, speed and language before starting a call.</p>}
      </> : null}
      {inCall || (configured && opts) ? <button type="button" className={`panel-row panel-row--action panel-row--call${inCall ? ' is-active' : ''}`} disabled={!inCall && !selectionValid} onClick={() => (inCall ? endCall() : startCall(bot.id))}>
        <Icon name="voice_a" size={14} opacity={inCall ? 1 : 0.56} /> {inCall ? 'End voice chat' : 'Start voice chat'}
      </button> : null}
      {error && <div className="voice-error" role="alert">{error}</div>}
    </div>
  );
}
