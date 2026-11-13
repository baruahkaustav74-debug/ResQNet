import React from 'react';
import { AlertTriangle, AlertOctagon, ShieldAlert, CheckCircle2 } from 'lucide-react';
import type { LanguageCode, Severity } from '../../shared/types';
import { severityLabel } from '../i18n/translations';

export const SEVERITY_COLORS: Record<Severity, { text: string; hex: string }> = {
  CRITICAL: { text: 'text-red-600 dark:text-red-400', hex: '#EF4444' },
  HIGH: { text: 'text-orange-600 dark:text-orange-400', hex: '#F97316' },
  MODERATE: { text: 'text-amber-600 dark:text-amber-400', hex: '#EAB308' },
  LOW: { text: 'text-emerald-600 dark:text-emerald-400', hex: '#10B981' },
};

export const SeverityIndicator: React.FC<{
  severity: Severity;
  lang: LanguageCode;
  className?: string;
}> = ({ severity, lang, className = '' }) => {
  const Icon =
    severity === 'CRITICAL'
      ? AlertOctagon
      : severity === 'HIGH'
        ? AlertTriangle
        : severity === 'MODERATE'
          ? ShieldAlert
          : CheckCircle2;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold tracking-tight ${SEVERITY_COLORS[severity].text} ${className}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{severityLabel(severity, lang)}</span>
    </span>
  );
};
