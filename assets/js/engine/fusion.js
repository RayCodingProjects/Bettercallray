/*
 * TrueFrame — evidence fusion.
 * Naive-Bayes style combination: per-layer log-likelihood ratios are summed (each
 * layer capped so one family of correlated checks cannot dominate), converted to a
 * probability, and mapped to a verdict with a confidence level and a summary.
 */
(function (root) {
  'use strict';
  const TF = (root.TrueFrame = root.TrueFrame || {});
  const U = TF.util;

  function pickVerdict(p, definitive) {
    if (definitive === 'ai') return { key: 'ai-confirmed', tone: 'ai', label: 'AI-generated', sub: 'Confirmed by data embedded in the file' };
    if (definitive === 'real') return { key: 'real-confirmed', tone: 'real', label: 'Real capture', sub: 'Backed by camera Content Credentials' };
    // Bands chosen on the evaluation set to keep false "AI" verdicts on real photos rare:
    // weak or conflicting evidence lands in "Inconclusive" rather than in a confident-sounding verdict.
    if (p >= 0.85) return { key: 'ai-likely', tone: 'ai', label: 'Likely AI-generated', sub: 'Strong signs of AI generation' };
    if (p >= 0.65) return { key: 'ai-possible', tone: 'ai', label: 'Possibly AI-generated', sub: 'Leaning towards AI' };
    if (p > 0.35) return { key: 'uncertain', tone: 'uncertain', label: 'Inconclusive', sub: 'The evidence is weak or mixed' };
    if (p > 0.15) return { key: 'real-possible', tone: 'real', label: 'Probably real', sub: 'Leaning towards a real capture' };
    return { key: 'real-likely', tone: 'real', label: 'Likely real', sub: 'Strong signs of a real capture' };
  }

  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  function summarize(signals, verdict, conflict, kind) {
    const noun = kind === 'video' ? 'video' : 'image';
    if (verdict.key === 'ai-confirmed') {
      const s = signals.find((x) => x.definitive === 'ai');
      return `${s.title}. Data written into the file by the tool that created it identifies this ${noun} as AI-generated.`;
    }
    const dir = verdict.tone === 'ai' ? 1 : verdict.tone === 'real' ? -1 : 0;
    if (dir === 0) {
      const top = signals.filter((s) => Math.abs(s.llr) >= 0.4).sort((a, b) => Math.abs(b.llr) - Math.abs(a.llr))[0];
      return (
        'The checks did not find enough evidence either way' +
        (top ? ` — the strongest finding is that ${lowerFirst(top.title)}, ${top.llr > 0 ? 'which leans AI' : 'which leans real'}` : '') +
        '. Treat this result with caution and check where the file came from.'
      );
    }
    const ranked = signals.filter((s) => s.llr * dir > 0.05).sort((a, b) => Math.abs(b.llr) - Math.abs(a.llr));
    const reasons = ranked.slice(0, 2).map((s) => lowerFirst(s.title));
    const lead = dir > 0 ? (ranked.length > 1 ? 'Several checks point to AI generation' : 'The evidence leans towards AI generation') : `Signs point to a real ${kind === 'video' ? 'recording' : 'camera photo'}`;
    let text = reasons.length > 1 ? `${lead} — mainly: ${reasons[0]}, and ${reasons[1]}.` : reasons.length ? `${lead} — mainly: ${reasons[0]}.` : `${lead}.`;
    if (conflict) text += ' Some checks disagree, so weigh this result with care.';
    return text;
  }

  function fuse(signals, kind) {
    const C = TF.evidence.CATEGORIES;
    const sums = {};
    for (const s of signals) {
      if (!sums[s.category]) sums[s.category] = { sum: 0, n: 0 };
      sums[s.category].sum += s.llr;
      sums[s.category].n++;
    }
    const categories = [];
    let logit = 0;
    for (const key of Object.keys(C)) {
      if (!sums[key]) continue;
      const v = U.clamp(sums[key].sum, -C[key].cap, C[key].cap);
      logit += v;
      categories.push({ key, label: C[key].label, icon: C[key].icon, score: v, count: sums[key].n });
    }
    const defAI = signals.some((s) => s.definitive === 'ai');
    const defReal = signals.some((s) => s.definitive === 'real');
    let definitive = null;
    if (defAI && !defReal) {
      logit = Math.max(logit, 4.6);
      definitive = 'ai';
    } else if (defReal && !defAI) {
      logit = Math.min(logit, -3.5);
      definitive = 'real';
    }
    const p = U.clamp(U.sigmoid(logit), 0.01, 0.99);
    const verdict = pickVerdict(p, definitive);
    const sgn = Math.sign(logit) || 1;
    const strongFor = categories.filter((c) => Math.sign(c.score) === sgn && Math.abs(c.score) >= 0.8).length;
    const strongAgainst = categories.filter((c) => Math.sign(c.score) === -sgn && Math.abs(c.score) >= 1.2).length;
    let confidence;
    if (definitive) confidence = 'high';
    else if (Math.abs(logit) >= 3 && strongFor >= 2 && !strongAgainst) confidence = 'high';
    else if (Math.abs(logit) >= 1.4 && strongFor >= 1) confidence = strongAgainst ? 'low' : 'medium';
    else confidence = 'low';
    const conflict = strongAgainst > 0 && !definitive;
    return { logit, p, verdict, confidence, conflict, definitive, categories, summary: summarize(signals, verdict, conflict, kind) };
  }

  TF.fusion = { fuse, pickVerdict };
})(typeof window !== 'undefined' ? window : globalThis);
