// リース負債の現在価値と月次の償却表（円未満は月ごとに四捨五入し、最終月で端数調整）

export const parseNum = (s) => {
  const n = parseFloat(String(s ?? '').replace(/[,，\s円%]/g, '').replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return Number.isFinite(n) ? n : 0;
};
export const yen = (n) => Math.round(n).toLocaleString('ja-JP');

export function presentValue(pay, months, annualRate, timing) {
  const r = annualRate / 100 / 12;
  if (r === 0) return pay * months;
  const pv = pay * (1 - Math.pow(1 + r, -months)) / r;
  return timing === 'advance' ? pv * (1 + r) : pv;
}

export function schedule({ pay, months, rate, timing = 'arrears', idc = 0 }) {
  const r = rate / 100 / 12;
  const liability = Math.round(presentValue(pay, months, rate, timing));
  const rou = liability + Math.round(idc || 0);
  const depBase = Math.round(rou / months);

  const rows = [];
  let bal = liability, rouBal = rou;
  for (let n = 1; n <= months; n++) {
    const open = bal;
    const last = n === months;
    // 前払いは支払後の残高に、後払いは期首残高に利息がつく
    let interest = Math.round((timing === 'advance' ? open - pay : open) * r);
    if (last) interest = pay - open; // 最終月で残高をゼロにそろえる
    const principal = pay - interest;
    bal = open - principal;
    const dep = last ? rouBal : depBase;
    rouBal -= dep;
    rows.push({ n, open, pay, interest, principal, close: bal, dep, rou: rouBal });
  }

  const years = [];
  for (let i = 0; i < rows.length; i += 12) {
    const chunk = rows.slice(i, i + 12);
    const sum = (k) => chunk.reduce((a, x) => a + x[k], 0);
    years.push({ year: i / 12 + 1, pay: sum('pay'), interest: sum('interest'), principal: sum('principal'), dep: sum('dep'), liab: chunk.at(-1).close, rou: chunk.at(-1).rou });
  }
  const tot = (k) => rows.reduce((a, x) => a + x[k], 0);
  return { liability, rou, rows, years, totals: { pay: tot('pay'), interest: tot('interest'), principal: tot('principal'), dep: tot('dep') } };
}
