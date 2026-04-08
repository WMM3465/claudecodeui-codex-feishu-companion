type TokenUsagePieProps = {
  used: number;
  total: number;
  showLabel?: boolean;
};

export default function TokenUsagePie({ used, total, showLabel = false }: TokenUsagePieProps) {
  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const getColor = () => {
    if (percentage < 70) return '#64748b';
    if (percentage < 85) return '#f59e0b';
    if (percentage < 95) return '#fb923c';
    return '#ef4444';
  };

  const getTextColor = () => {
    if (percentage < 70) return 'text-muted-foreground';
    if (percentage < 85) return 'text-amber-500';
    if (percentage < 95) return 'text-orange-500';
    return 'text-red-500';
  };

  const getUsageLabel = () => {
    if (percentage < 70) return '线程上下文';
    if (percentage < 85) return '上下文偏高';
    if (percentage < 95) return '接近上限';
    return '即将满载';
  };

  const title = `${getUsageLabel()}\n已用 ${used.toLocaleString()} 标记，共 ${total.toLocaleString()} 标记`;

  return (
    <div className={`flex items-center gap-2 text-xs ${getTextColor()}`} title={title}>
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90 transform">
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-300 dark:text-gray-600"
        />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {showLabel && <span className="hidden sm:inline">{getUsageLabel()}</span>}
      <span>{percentage.toFixed(1)}%</span>
    </div>
  );
}
