import { clsx, type ClassValue } from "clsx";
type polarproducts = {
  productId: string;
  slug: string;
  name: string;
  description: string;
  price: {
    monthly: number;
    yearly: number;
  };
  features: string[];
  cta: string;
  popular?: boolean;
};

export const subscriptions: polarproducts[] = [
  {
    productId: "b73e4d49-befb-4da6-a4b4-a4c3ecc5fdb3", // ID of Product from Polar Dashboard
    slug: "plus", // Custom slug for easy reference in Checkout URL, e.g. /checkout/pro
    name: "Starter",
    price: {
      monthly: 15,
      yearly: 55,
    },
    description: "Everything you need to build and scale your business.",
    features: [
      "Unlimited API calls",
      "30 second checks",
      "Multi-user account",
      "10 monitors",
      "Priority email support",
    ],
    cta: "Subscribe to Starter",
  },
  {
    productId: "33a84d76-3d52-4007-a66c-bb8b77bd5313", // ID of Product from Polar Dashboard
    slug: "pro", // Custom slug for easy reference in Checkout URL, e.g. /checkout/pro
    name: "Pro",
    price: {
      monthly: 25,
      yearly: 70,
    },
    description: "Everything you need to build and scale your business.",
    features: [
      "Unlimited API calls",
      "30 second checks",
      "Multi-user account",
      "10 monitors",
      "Priority email support",
    ],
    cta: "Subscribe to Pro",
    popular: true,
  },
  {
    productId: "23e42923-3d5f-4e7e-877f-860c58f9f414", // ID of Product from Polar Dashboard
    slug: "max", // Custom slug for easy reference in Checkout URL, e.g. /checkout/pro
    name: "Enterprise",
    price: {
      monthly: 45,
      yearly: 100,
    },
    description: "Everything you need to build and scale your business.",
    features: [
      "Unlimited API calls",
      "30 second checks",
      "Multi-user account",
      "10 monitors",
      "Priority email support",
    ],
    cta: "Subscribe to Enterprise",
  },
];
