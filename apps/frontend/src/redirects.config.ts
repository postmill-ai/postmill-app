type Redirect = {
  source: string;
  destination: string;
  permanent: boolean;
};

export const redirectsList: Redirect[] = [
  {
    source: '/launches',
    destination: '/posts',
    permanent: true,
  },
  {
    source: '/schedule',
    destination: '/posts',
    permanent: true,
  },
  {
    source: '/schedule/:path*',
    destination: '/posts/:path*',
    permanent: true,
  },
  {
    source: '/api/uploads/:path*',
    destination: '/uploads/:path*',
    permanent: true,
  },
];

export async function redirects(): Promise<Redirect[]> {
  return redirectsList;
}
