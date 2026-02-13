export function CharacterSheet({ character }) {
  return `<div class="character-sheet">
    ${Attributes({ attributes: character.attributes })}
  </div>`;
}
function Attributes({ attributes }) {
  return `<div class="attributes">
            <header>Attributes</header>
            <table>
                ${attributes
                  .map((attribute) => Attribute({ attribute }))
                  .join("")}
            </table>
        </div>`;
}
function Attribute({ attribute }) {
  return `<tr>
            <td>${attribute.name}</td>
            <td>${Modifier({ attribute })}</td>
        </tr>`;
}
function Modifier({ attribute }) {
  const modifierLabel = renderModifierLabel(attribute.modifier);
  const components = Object.entries(attribute.components)
    .map(([key, val]) => `${key}: ${val}`)
    .join("\n");

  return `<span class="appear-as-link" title="${components}">${modifierLabel}</span>`;

  function renderModifierLabel(modifier) {
    if (isNaN(modifier)) return "?";
    if (modifier > 0) return `+${modifier}`;
    if (modifier === 0) return "+0";
    if (modifier < 0) return modifier;
    return "??";
  }
}
