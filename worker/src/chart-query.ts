/** KRX short codes can contain letters (especially preferred-share tickers). */
export function validChartCode(code:string):boolean {
 return /^[0-9A-Z]{6}$/.test(code);
}
