export default function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`kpi${tone ? ` tone-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}
