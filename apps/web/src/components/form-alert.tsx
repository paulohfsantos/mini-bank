import ui from './ui.module.css';

export function FormAlert({
  message,
  correlationId,
}: {
  message?: string;
  correlationId?: string;
}) {
  if (!message) return null;
  return (
    <div className={ui.alert} role="alert">
      <p style={{ margin: 0 }}>{message}</p>
      {correlationId && <p className={ui.mono}>Protocolo para suporte: {correlationId}</p>}
    </div>
  );
}
