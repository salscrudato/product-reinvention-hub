// describeForm — cache-first plain-English form description via claude-haiku-4-5.
// Any authenticated role may call it. If the form already has a non-empty description
// the cached value is returned immediately (no AI call). Otherwise haiku generates
// a 2-3 sentence plain-English summary and writes it back to forms/{formKey} so the
// next caller gets an instant cache hit.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { ANTHROPIC_API_KEY, anthropic, MODEL_FAST } from './runtime'
import { emptyUsage, addUsage, recordUsage } from './telemetry'

if (!getApps().length) initializeApp()

interface DescribeFormInput {
  formKey: string  // Firestore doc key inside the `forms` collection
}

export const describeForm = onCall<DescribeFormInput>(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 5 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to generate form descriptions.')

    const { formKey } = req.data
    if (!formKey?.trim()) throw new HttpsError('invalid-argument', 'formKey is required.')

    const db  = getFirestore()
    const ref = db.doc(`forms/${formKey}`)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpsError('not-found', `Form ${formKey} not found.`)

    const data = snap.data() as Record<string, unknown>

    // Cache hit — return immediately if a non-empty description is already stored.
    const cached = typeof data.description === 'string' && data.description.trim().length > 0
    if (cached) return { description: data.description as string, cached: true }

    // Generate a plain-English summary. We pass the structural metadata only — no
    // invented content. haiku-4-5 is the right model for this simple classification task.
    const number   = String(data.number ?? '')
    const name     = String(data.name ?? '')
    const category = String(data.category ?? '')
    const edition  = String(data.edition ?? '')
    const source   = String(data.source ?? '')
    const dynFields = Array.isArray(data.dynamicFields)
      ? (data.dynamicFields as { name: string }[]).map((f) => f.name).join(', ')
      : ''

    const prompt = [
      `Form number: ${number}`,
      `Name: ${name}`,
      `Category: ${category.replace(/_/g, ' ')}`,
      `Edition: ${edition}`,
      `Source: ${source}`,
      dynFields ? `Dynamic fields: ${dynFields}` : '',
    ].filter(Boolean).join('\n')

    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    try {
      const msg = await anthropic().messages.create({
        model: MODEL_FAST,
        max_tokens: 200,
        system:
          'You are an insurance policy analyst. Write a plain-English 2-3 sentence description of the ' +
          'given insurance form for a product manager audience. Be factual, concise, and accurate. ' +
          'Do not invent coverage details not provided in the input.',
        messages: [{ role: 'user', content: prompt }],
      })
      addUsage(usageAccum, msg.usage)

      const description = (msg.content.find((b) => b.type === 'text')?.text ?? '').trim()
      if (!description) throw new HttpsError('internal', 'AI returned an empty description.')

      // Write back to the form document. This is a direct admin SDK write (no mutate()
      // audit overhead) because description is a derived/cached field, not an authored change.
      await ref.set({ description }, { merge: true })

      return { description, cached: false }
    } catch (err) {
      ok = false
      throw err
    } finally {
      void recordUsage({ feature: 'describeForm', model: MODEL_FAST, usage: usageAccum, latencyMs: Date.now() - t0, ok })
    }
  },
)
