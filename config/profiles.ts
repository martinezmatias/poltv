export type ViewerProfile = {
  id: string;
  name: string;
  role: "grandmother" | "grandfather" | "boy" | "girl";
  image: string;
};

export const VIEWER_PROFILES: ViewerProfile[] = [
  { id: "amalia", name: "Amalia", role: "grandmother", image: "/resources/users/abuela.png?v=2" },
  { id: "mateo", name: "Mateo", role: "grandfather", image: "/resources/users/abuelo.png?v=2" },
  { id: "leo", name: "Leo", role: "boy", image: "/resources/users/nene.png?v=2" },
  { id: "ines", name: "Inés", role: "girl", image: "/resources/users/nena.png?v=2" },
];

export const DEFAULT_VIEWER_PROFILE_ID = "leo";
