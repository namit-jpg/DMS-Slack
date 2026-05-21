export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'long' })}, ${d.getFullYear()}`;
}

export function formatDateTime(date?: string | Date): string {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : new Date();
  const datePart = `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}, ${d.getFullYear()}`;
  const timePart = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return `${datePart} ${timePart}`;
}

export function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
