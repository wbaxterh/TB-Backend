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
  imageAlt: Joi.string().trim().max(240).allow(''),
  imageSourceUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow(''),
  reviewSummary: Joi.object({
    source: Joi.string().valid('Google').required(),
    rating: Joi.number().min(0).max(5).required(),
    reviewCount: Joi.number().integer().min(0).required(),
    summary: Joi.string().trim().min(20).max(1200).required(),
    sourceUrl: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .required(),
    asOf: Joi.date().iso().required(),
  }),
  faqs: Joi.array()
    .items(
      Joi.object({
        question: Joi.string().trim().min(10).max(180).required(),
        answer: Joi.string().trim().min(10).max(600).required(),
      }),
    )
    .max(8)
    .unique('question')
    .default([]),
  pressFeatures: Joi.array()
    .items(
      Joi.object({
        title: Joi.string().trim().min(2).max(240).required(),
        publisher: Joi.string().trim().min(2).max(120).required(),
        url: Joi.string()
          .uri({ scheme: ['http', 'https'] })
          .required(),
        publishedAt: Joi.date().iso(),
        summary: Joi.string().trim().max(600).allow(''),
      }),
    )
    .max(20)
    .unique('url')
    .default([]),
  teamRiders: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().trim().min(2).max(120).required(),
        role: Joi.string().trim().max(80).allow(''),
        profileUrl: Joi.string()
          .uri({ scheme: ['http', 'https'] })
          .allow(''),
        sourceUrl: Joi.string()
          .uri({ scheme: ['http', 'https'] })
          .allow(''),
        imageUrl: Joi.string()
          .uri({ scheme: ['http', 'https'] })
          .allow(''),
      }),
    )
    .max(30)
    .unique((a, b) => a.name.toLowerCase() === b.name.toLowerCase())
    .default([]),
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
