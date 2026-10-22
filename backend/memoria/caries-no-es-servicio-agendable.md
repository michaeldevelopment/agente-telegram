---
name: caries-no-es-servicio-agendable
description: "Caries" es motivo de consulta, no servicio; el paciente que la menciona va a valoración
metadata:
  type: decision
---

**"Caries" no se modeló como servicio** aunque el cliente la mencionó entre lo que ofrece. Es un **motivo de consulta**, no algo agendable.

**Por qué:** el paciente que escribe *"creo que tengo una caries"* o *"tengo una picadura"* está **autodiagnosticándose**. Si el agente agenda directo una `resina`, está confirmando ese diagnóstico — exactamente lo que no puede hacer. Puede que no sea caries, puede que sea otra cosa, puede que necesite endodoncia.

**Cómo aplicarlo:** quien menciona caries, picadura o diente picado termina en `valoracion` — que además es **gratis**, así que la conversación no pierde nada. El tratamiento real (`resina`, `endodoncia`, lo que sea) lo define el odontólogo en consulta.

El vocabulario del paciente para esto está en `CONTEXTO.md`: "picadura", "diente picado", "me salió un hueco", "tapar la muela".

Relacionado: [[nunca-diagnosticar-ni-recetar]], [[valoracion-gratuita]], [[catalogo-13-servicios]]
