export type ViewerProfile = {
  id: string;
  name: string;
  role: "grandmother" | "grandfather" | "boy" | "girl";
  image: string;
};

export const VIEWER_PROFILES: ViewerProfile[] = [
  { id: "amalia", name: "Amalia", role: "grandmother", image: "/resources/users/abuela.png" },
  { id: "mateo", name: "Mateo", role: "grandfather", image: "/resources/users/abuelo.png" },
  { id: "leo", name: "Leo", role: "boy", image: "/resources/users/nene.png" },
  { id: "ines", name: "Inés", role: "girl", image: "/resources/users/nena.png" },
];

export const DEFAULT_VIEWER_PROFILE_ID = "amalia";
