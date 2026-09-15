const Joi = require('joi');

const SPORTS = [
  'skateboarding',
  'snowboarding',
  'skiing',
  'surfing',
  'bmx',
  'mtb',
  'scooter',
  'rollerblading',
  'wakeboarding',
];
const SERVICES = ['gear', 'apparel', 'repairs', 'rentals', 'lessons', 'online'];

const schema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  slug: Joi.string()
    .lowercase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .required(),
  description: Joi.string().trim().max(1200).allow('').default(''),
  sports: Joi.array()
    .items(Joi.string().valid(...SPORTS))
    .min(1)
    .unique()
    .required(),
  services: Joi.array()
    .items(Joi.string().valid(...SERVICES))
    .unique()
    .default([]),
  address: Joi.object({
    street: Joi.string().trim().max(160).allow(''),
    city: Joi.string().trim().max(100).required(),
    region: Joi.string().trim().max(100).allow(''),
    postalCode: Joi.string().trim().max(24).allow(''),
    country: Joi.string().trim().max(100).required(),
    lat: Joi.number().min(-90).max(90),
    lng: Joi.number().min(-180).max(180),
  }).required(),
  website: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow(''),
  phone: Joi.string().trim().max(40).allow(''),
  imageUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow(''),
  hours: Joi.alternatives().try(Joi.string().max(1000), Joi.object()).optional(),
  socialLinks: Joi.object().pattern(Joi.string(), Joi.string().uri({ scheme: ['http', 'https'] })),
  verified: Joi.boolean().default(false),
  featured: Joi.boolean().default(false),
  status: Joi.string().valid('draft', 'published').default('draft'),
  sourceUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
}).options({ stripUnknown: true });

function normalizeShop(input) {
  const { error, value } = schema.validate(input, { abortEarly: false });
  if (error) {
    const problem = new Error(error.details.map((detail) => detail.message).join('; '));
    problem.code = 'INVALID_SHOP';
    throw problem;
  }

  const now = new Date();
  const address = { ...value.address };
  if (typeof address.lat === 'number' && typeof address.lng === 'number') {
    address.location = { type: 'Point', coordinates: [address.lng, address.lat] };
  }

  return {
    ...value,
    address,
    updatedAt: now,
  };
}

module.exports = { normalizeShop, SERVICES, SPORTS };
