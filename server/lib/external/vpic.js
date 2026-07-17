'use strict'
// external/vpic.js — NHTSA vPIC VIN decoder for the Personal Auto line.
// Free, keyless federal API. Probe-verified 2026-07-15.

const BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles'

/** Decode a VIN to normalized vehicle attributes (rating-relevant subset).
 *  Partial VINs are allowed (vPIC pads); pass modelYear when known for accuracy.
 *  @param {string} vin
 *  @param {object} [opts]
 *  @param {number|string} [opts.modelYear]
 *  @returns {Promise<{ vin, make, model, modelYear, bodyClass, doors, vehicleType,
 *                      engine: { displacementL, cylinders, fuelType }, plantCountry,
 *                      errorCode, errorText }>} errorCode '0' = clean decode */
async function decodeVin(vin, opts = {}) {
  const params = new URLSearchParams({ format: 'json' })
  if (opts.modelYear) params.set('modelyear', String(opts.modelYear))
  const res = await fetch(`${BASE}/DecodeVinValues/${encodeURIComponent(vin)}?${params}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) { const e = new Error(`vpic_${res.status}`); e.status = res.status; throw e }
  const r = (await res.json()).Results?.[0] || {}
  return {
    vin,
    make: r.Make || null,
    model: r.Model || null,
    modelYear: r.ModelYear || null,
    bodyClass: r.BodyClass || null,
    doors: r.Doors || null,
    vehicleType: r.VehicleType || null,
    engine: { displacementL: r.DisplacementL || null, cylinders: r.EngineCylinders || null, fuelType: r.FuelTypePrimary || null },
    plantCountry: r.PlantCountry || null,
    errorCode: r.ErrorCode || null,
    errorText: r.ErrorText || null,
  }
}

module.exports = { decodeVin }
