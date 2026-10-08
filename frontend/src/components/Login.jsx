import { useState } from "react";
import { login } from "../services/api";

function Login({ onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError(null);
    setLoading(true);

    try {
      const result = await login(username, password);

      setUsername("");
      setPassword("");

      // result contient l'utilisateur connecté
      onSuccess(result);
    } catch (err) {
      setError(
        err?.message || "Nom d'utilisateur ou mot de passe incorrect."
      );
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
          Nom d'utilisateur
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
            disabled={loading}
            placeholder="Votre nom d'utilisateur"
          />
        </label>

        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            placeholder="Votre mot de passe"
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <button
          className="button"
          type="submit"
          disabled={loading || !username.trim() || !password}
        >
          {loading ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}

export default Login;