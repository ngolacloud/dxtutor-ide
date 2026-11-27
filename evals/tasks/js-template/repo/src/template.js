/** Fills {{key}} placeholders. */
export function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(data[k]));
}
