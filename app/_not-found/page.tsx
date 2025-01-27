import Link from "next/link";

const NotFound = () => {
  return (
    <div className="app-container">
      <h1 className="m-4 font-bold">404 - Not Found</h1>
      <p className="text-dark">The page you are looking for does not exist.</p>
      <Link href="/" className="text-primary transition-colors duration-200 hover:text-dark">Go back home</Link>
    </div>
  )
}

export default NotFound;