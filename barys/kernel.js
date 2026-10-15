const skills = [];

export function registerSkill(skill) {
  if (!skill || !skill.id) return;
  const index = skills.findIndex((item) => item.id === skill.id);
  if (index >= 0) skills[index] = skill;
  else skills.push(skill);
  skills.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export function listSkills() {
  return skills.slice();
}

export function toolDefs() {
  const tools = [];
  for (const skill of skills) {
    for (const tool of skill.tools || []) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || { type: "object", properties: {} },
        },
      });
    }
  }
  return tools;
}

export function findTool(name) {
  for (const skill of skills) {
    for (const tool of skill.tools || []) {
      if (tool.name === name) return { skill, tool };
    }
  }
  return null;
}

export async function runTool(name, args, ctx) {
  const found = findTool(name);
  if (!found) return { text: `Неизвестный инструмент: ${name}` };
  try {
    const result = await found.skill.run({ ...(args || {}), tool: name }, ctx || {});
    if (!result || !result.text) return { text: `Инструмент ${name} не вернул данных.` };
    return result;
  } catch (err) {
    const message = err && err.message ? err.message : "unknown";
    return { text: `Ошибка инструмента ${name}: ${message}` };
  }
}

function unknownReply(ctx) {
  const contacts = ctx.contacts || {};
  const channels = [contacts.whatsappUrl, contacts.telegramUrl].map((value) => String(value || "").trim()).filter(Boolean);
  const handoff = channels.length ? ` или напишите Барысу: ${channels.join(" / ")}` : "";
  return {
    text:
      "Не нашёл точного совпадения. Спросите про каталог, цену конкретного ЖБИ" +
      handoff +
      ".\nПримеры: «какие товары», «сколько стоит свая», «контакты».",
    handoff: false,
    topic: String(ctx.raw || "").trim(),
  };
}

export function runLocal(ctx) {
  const safe = ctx || {};
  const text = String(safe.raw || "").trim();
  for (const skill of skills) {
    if (typeof skill.match !== "function") continue;
    let args = null;
    try {
      args = skill.match(text, safe);
    } catch {
      args = null;
    }
    if (args == null) continue;
    try {
      const result = skill.run(args, { ...safe, raw: text });
      if (result && result.text) return result;
    } catch {
      continue;
    }
  }
  return unknownReply({ ...safe, raw: text });
}
