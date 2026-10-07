import { useState } from "react";

import { login } from "../services/api";

function Login({ onSuccess }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(token);
      setToken("");          // le jeton ne reste pas en mémoire après la connexion
      onSuccess();
    } catch {
      setError("Jeton invalide.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="panel login-panel" onSubmit={handleSubmit}>
        <h1>SENTINEL-X</h1>
        <p>Centre de supervision</p>

        <label>
          Jeton d'accès
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoFocus
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <button className="button" type="submit" disabled={loading || !token}>
          {loading ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}

export default Login;
