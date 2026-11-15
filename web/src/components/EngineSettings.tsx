import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bot, EngineInfo } from '@shared/types';
import { configApi } from '../lib/configApi';
import { useStore } from '../store';
import { Icon } from './Icon';

const STATUS: Record<EngineInfo['status'], string> = { ready: 'ready', starting: 'starting', stopped: 'stopped', error: 'error' };

/** Provider/model configuration belongs to Hermes; this panel reports its actual state. */
export function EngineSettings({ bot }: { bot: Bot }) {
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [busy, setBusy] = useState<'restart' | 'screen' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const request = useRef(0);
  const botId = bot.id;

  const apply = useCallback((reported: EngineInfo) => {
    setEngine(reported); setPhase('ok');
    useStore.setState((state) => ({ bots: state.bots.map((agent) => (
      agent.id === reported.botId && (agent.model !== reported.model || agent.provider !== reported.provider)
        ? { ...agent, model: reported.model, provider: reported.provider }
        : agent
    )) }));
  }, []);

  const load = useCallback(() => {
    const revision = ++request.current;
    setPhase('loading'); setNote(null);
    configApi.engine(botId).then((result) => {
      if (request.current !== revision) return;
      if (result?.engine) apply(result.engine);
      else setPhase('unavailable');
    }).catch(() => { if (request.current === revision) setPhase('unavailable'); });
  }, [botId, apply]);

  useEffect(() => {
    setEngine(null); setBusy(null); load();
    return () => { request.current++; };
  }, [load]);

  const act = async (operation: 'restart' | 'screen') => {
    if (busy || engine?.kind !== 'managed') return;
    const revision = ++request.current;
    setBusy(operation); setNote(null);
    try {
      const result = await (operation === 'restart' ? configApi.restartEngine(botId) : configApi.stopOwnScreen(botId));
      if (request.current === revision) apply(result.engine);
    } catch (failure) {
      if (request.current === revision) setNote(`Couldn’t ${operation === 'restart' ? 'restart the agent' : 'switch screens'}: ${(failure as Error).message || 'Hermes did not answer'}`);
    } finally { if (request.current === revision) setBusy(null); }
  };

  if (phase !== 'ok' || !engine) return (
    <div className="panel-card">
      <div className="panel-empty engine__empty" role="status">
        {phase === 'loading' ? 'Checking Hermes…' : <><span>Engine unavailable</span><button type="button" className="link-btn link-btn--small" onClick={load}>Try again</button></>}
      </div>
    </div>
  );

  const providerName = engine.providers.find((provider) => provider.id === engine.provider)?.name ?? engine.provider;
  return (
    <div className="panel-card engine">
      <div className="panel-row panel-row--setting"><span>Provider</span><span>{providerName || 'Not reported by Hermes'}</span></div>
      <div className="panel-row panel-row--setting"><span>Model</span><span>{engine.model || 'Not reported by Hermes'}</span></div>
      <div className="engine__notice">
        <span>Change provider and model in Hermes, then refresh.</span>
        <button type="button" className="link-btn link-btn--small" onClick={load} disabled={!!busy}>Refresh engine</button>
      </div>
      {engine.kind === 'managed' && engine.ownScreen && <div className="engine__notice">
        <span>{bot.name} also has a private screen. Its desktop work there is separate from this viewer.</span>
        <button type="button" className="link-btn link-btn--small" onClick={() => act('screen')} disabled={!!busy}>{busy === 'screen' ? 'Switching…' : 'Use this screen'}</button>
      </div>}
      {note && <div className="voice-error" role="alert">{note}</div>}
      <div className="engine__meta">
        <span className={`engine__state is-${engine.status}`} title={engine.version ? `Hermes ${engine.version}` : undefined}>
          <i aria-hidden />Hermes · profile {engine.profile} · {STATUS[engine.status] ?? engine.status}
        </span>
        {engine.kind === 'managed' && (engine.status === 'error' || engine.status === 'stopped') && <button type="button" className="link-btn link-btn--small" onClick={() => act('restart')} disabled={!!busy}>{busy === 'restart' ? 'Restarting…' : 'Restart agent'}</button>}
      </div>
      {engine.kind === 'primary' && <div className="engine__notice"><Icon name="monitor" size={14} /><span>This gateway is managed in Hermes.</span></div>}
      {engine.status === 'error' && engine.error && <div className="engine__error" role="alert">{engine.error}</div>}
    </div>
  );
}
