import { useEffect, useState } from "react";

import {
  getUsers,
  createUser,
  updateUserPassword,
  deleteUser,
} from "../services/api";

function Users({ currentUser, onLogout }) {
  const [users, setUsers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  // ------------------------------------------------------
  // Password modal
  // ------------------------------------------------------

  const [passwordUser, setPasswordUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // ------------------------------------------------------
  // Delete modal
  // ------------------------------------------------------

  const [deleteUserTarget, setDeleteUserTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ------------------------------------------------------
  // Load users
  // ------------------------------------------------------

  async function loadUsers() {
    try {
      setLoading(true);
      setError("");

      const data = await getUsers();

      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Erreur chargement utilisateurs:", err);

      setError(
        err.message ||
          "Impossible de charger les utilisateurs."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  // ------------------------------------------------------
  // Create user
  // ------------------------------------------------------

  async function handleCreate(event) {
    event.preventDefault();

    setError("");

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setError(
        "Le nom d'utilisateur est obligatoire."
      );
      return;
    }

    if (password.length < 8) {
      setError(
        "Le mot de passe doit contenir au moins 8 caractères."
      );
      return;
    }

    try {
      setCreating(true);

      await createUser({
        username: cleanUsername,
        password,
        role: "user",
      });

      setUsername("");
      setPassword("");
      setShowCreateForm(false);

      await loadUsers();
    } catch (err) {
      console.error("Erreur création utilisateur:", err);

      setError(
        err.message ||
          "Impossible de créer l'utilisateur."
      );
    } finally {
      setCreating(false);
    }
  }

  // ------------------------------------------------------
  // Password modal
  // ------------------------------------------------------

  function openPasswordModal(user) {
    setPasswordUser(user);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  }

  function closePasswordModal() {
    if (passwordLoading) {
      return;
    }

    setPasswordUser(null);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();

    setPasswordError("");

    if (!newPassword) {
      setPasswordError(
        "Le nouveau mot de passe est obligatoire."
      );
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(
        "Le mot de passe doit contenir au moins 8 caractères."
      );
      return;
    }

    if (!confirmPassword) {
      setPasswordError(
        "Veuillez confirmer le mot de passe."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(
        "Les deux mots de passe ne correspondent pas."
      );
      return;
    }

    try {
      setPasswordLoading(true);

      await updateUserPassword(
        passwordUser.id,
        newPassword
      );

      closePasswordModal();

      setError("");

      await loadUsers();
    } catch (err) {
      console.error(
        "Erreur modification mot de passe:",
        err
      );

      setPasswordError(
        err.message ||
          "Impossible de modifier le mot de passe."
      );
    } finally {
      setPasswordLoading(false);
    }
  }

  // ------------------------------------------------------
  // Delete modal
  // ------------------------------------------------------

  function openDeleteModal(user) {
    if (user.id === currentUser?.id) {
      setError(
        "Vous ne pouvez pas supprimer votre propre compte."
      );
      return;
    }

    setDeleteUserTarget(user);
  }

  function closeDeleteModal() {
    if (deleteLoading) {
      return;
    }

    setDeleteUserTarget(null);
  }

  async function handleDelete() {
    if (!deleteUserTarget) {
      return;
    }

    try {
      setDeleteLoading(true);
      setError("");

      await deleteUser(deleteUserTarget.id);

      setDeleteUserTarget(null);

      await loadUsers();
    } catch (err) {
      console.error(
        "Erreur suppression utilisateur:",
        err
      );

      setError(
        err.message ||
          "Impossible de supprimer l'utilisateur."
      );
    } finally {
      setDeleteLoading(false);
    }
  }

  // ------------------------------------------------------
  // Render
  // ------------------------------------------------------

  return (
    <div className="users-page">

      {/* ==================================================
          HEADER
          ================================================== */}

      <header className="page-header">

        <div className="page-title">
          <h1>Gestion des utilisateurs</h1>

          <p>
            Administration des comptes SENTINEL-X
          </p>
        </div>

        <div className="user-info">

          <span className="logged-user">
            Connecté :
            {" "}
            <strong>
              {currentUser?.username}
            </strong>

            <span className="admin-badge">
              Administrateur
            </span>
          </span>

          <button
            type="button"
            className="button button-secondary users-action-button"
            onClick={onLogout}
          >
            Déconnexion
          </button>

        </div>

      </header>

      {/* ==================================================
          GLOBAL ERROR
          ================================================== */}

      {error && (
        <div className="error-banner users-error">
          <span>{error}</span>

          <button
            type="button"
            className="error-close"
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}

      {/* ==================================================
          MAIN PANEL
          ================================================== */}

      <section className="panel users-panel">

        {/* ------------------------------------------------
            SECTION HEADER
            ------------------------------------------------ */}

        <div className="section-header">

          <div>
            <h2>Utilisateurs</h2>

            <p className="section-description">
              Gérez les comptes utilisateurs de SENTINEL-X.
            </p>
          </div>

          <div className="section-actions">

            <button
              type="button"
              className="button button-secondary users-action-button"
              onClick={loadUsers}
              disabled={loading}
            >
              {loading
                ? "Actualisation..."
                : "Actualiser"}
            </button>

            <button
              type="button"
              className="button users-action-button"
              onClick={() =>
                setShowCreateForm(!showCreateForm)
              }
            >
              {showCreateForm
                ? "Annuler"
                : "+ Ajouter un utilisateur"}
            </button>

          </div>

        </div>

        {/* =================================================
            CREATE USER
            ================================================= */}

        {showCreateForm && (
          <form
            className="user-create-form"
            onSubmit={handleCreate}
          >

            <div className="create-form-header">
              <div>
                <h3>Ajouter un utilisateur</h3>

                <p>
                  Créez un nouveau compte utilisateur.
                </p>
              </div>
            </div>

            <div className="form-grid">

              {/* Username */}

              <div className="form-field">

                <label htmlFor="new-username">
                  Nom d'utilisateur
                </label>

                <input
                  id="new-username"
                  type="text"
                  value={username}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  placeholder="ex. operator2"
                  autoComplete="off"
                />

              </div>

              {/* Password */}

              <div className="form-field">

                <label htmlFor="new-user-password">
                  Mot de passe
                </label>

                <input
                  id="new-user-password"
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  placeholder="Minimum 8 caractères"
                  autoComplete="new-password"
                />

              </div>

              {/* Role */}

              <div className="form-field">

                <label htmlFor="new-user-role">
                  Rôle
                </label>

                <div className="role-display">
                  <span className="role-badge role-user">
                    Utilisateur
                  </span>
                </div>

                <input
                  id="new-user-role"
                  type="hidden"
                  value="user"
                  readOnly
                />

              </div>

            </div>

            <div className="create-form-actions">

              <button
                type="button"
                className="button button-secondary users-action-button"
                onClick={() => {
                  setShowCreateForm(false);
                  setUsername("");
                  setPassword("");
                }}
                disabled={creating}
              >
                Annuler
              </button>

              <button
                type="submit"
                className="button users-action-button"
                disabled={
                  creating ||
                  !username.trim() ||
                  password.length < 8
                }
              >
                {creating
                  ? "Création..."
                  : "Créer l'utilisateur"}
              </button>

            </div>

          </form>
        )}

        {/* =================================================
            USERS TABLE
            ================================================= */}

        {loading ? (

          <div className="loading users-loading">
            <div className="loading-spinner" />
            <span>
              Chargement des utilisateurs...
            </span>
          </div>

        ) : users.length === 0 ? (

          <div className="empty-state">
            <h3>Aucun utilisateur</h3>

            <p>
              Aucun compte utilisateur n'est actuellement
              enregistré.
            </p>
          </div>

        ) : (

          <div className="users-table-wrapper">

            <table className="users-table">

              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle</th>
                  <th>Date de création</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>

                {users.map((user) => (

                  <tr key={user.id}>

                    {/* Username */}

                    <td>

                      <div className="user-name-cell">

                        <strong>
                          {user.username}
                        </strong>

                        {user.id === currentUser?.id && (
                          <span className="current-user">
                            Vous
                          </span>
                        )}

                      </div>

                    </td>

                    {/* Role */}

                    <td>

                      <span
                        className={
                          user.role === "admin"
                            ? "role-badge role-admin"
                            : "role-badge role-user"
                        }
                      >
                        {user.role === "admin"
                          ? "Administrateur"
                          : "Utilisateur"}
                      </span>

                    </td>

                    {/* Created date */}

                    <td>

                      <span className="created-date">
                        {user.created_at
                          ? new Date(
                              user.created_at
                            ).toLocaleString("fr-FR")
                          : "—"}
                      </span>

                    </td>

                    {/* Actions */}

                    <td>

                      <div className="user-actions">

                        <button
                          type="button"
                          className="button button-secondary user-action-button"
                          onClick={() =>
                            openPasswordModal(user)
                          }
                        >
                          Mot de passe
                        </button>

                        <button
                          type="button"
                          className="button danger user-action-button"
                          disabled={
                            user.id === currentUser?.id
                          }
                          onClick={() =>
                            openDeleteModal(user)
                          }
                        >
                          Supprimer
                        </button>

                      </div>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </section>

      {/* ==================================================
          PASSWORD MODAL
          ================================================== */}

      {passwordUser && (

        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !passwordLoading
            ) {
              closePasswordModal();
            }
          }}
        >

          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-modal-title"
          >

            <div className="modal-header">

              <div>
                <h2 id="password-modal-title">
                  Modifier le mot de passe
                </h2>

                <p>
                  Modification du mot de passe de{" "}
                  <strong>
                    {passwordUser.username}
                  </strong>
                </p>
              </div>

              <button
                type="button"
                className="modal-close"
                onClick={closePasswordModal}
                disabled={passwordLoading}
                aria-label="Fermer"
              >
                ×
              </button>

            </div>

            <form
              className="modal-form"
              onSubmit={handlePasswordSubmit}
            >

              <div className="form-field">

                <label htmlFor="password-new">
                  Nouveau mot de passe
                </label>

                <input
                  id="password-new"
                  type="password"
                  value={newPassword}
                  onChange={(event) =>
                    setNewPassword(event.target.value)
                  }
                  placeholder="Minimum 8 caractères"
                  autoComplete="new-password"
                  autoFocus
                />

              </div>

              <div className="form-field">

                <label htmlFor="password-confirm">
                  Confirmer le mot de passe
                </label>

                <input
                  id="password-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(
                      event.target.value
                    )
                  }
                  placeholder="Retapez le mot de passe"
                  autoComplete="new-password"
                />

              </div>

              {passwordError && (
                <div className="modal-error">
                  {passwordError}
                </div>
              )}

              <div className="modal-actions">

                <button
                  type="button"
                  className="button button-secondary users-action-button"
                  onClick={closePasswordModal}
                  disabled={passwordLoading}
                >
                  Annuler
                </button>

                <button
                  type="submit"
                  className="button users-action-button"
                  disabled={
                    passwordLoading ||
                    !newPassword ||
                    !confirmPassword
                  }
                >
                  {passwordLoading
                    ? "Modification..."
                    : "Enregistrer"}
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

      {/* ==================================================
          DELETE MODAL
          ================================================== */}

      {deleteUserTarget && (

        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !deleteLoading
            ) {
              closeDeleteModal();
            }
          }}
        >

          <div
            className="modal modal-small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
          >

            <div className="modal-header">

              <div>
                <h2 id="delete-modal-title">
                  Supprimer l'utilisateur
                </h2>

                <p>
                  Cette action est définitive.
                </p>
              </div>

              <button
                type="button"
                className="modal-close"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                aria-label="Fermer"
              >
                ×
              </button>

            </div>

            <div className="delete-content">

              <p>
                Voulez-vous vraiment supprimer le compte
                {" "}
                <strong>
                  {deleteUserTarget.username}
                </strong>
                {" "}?
              </p>

            </div>

            <div className="modal-actions">

              <button
                type="button"
                className="button button-secondary users-action-button"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
              >
                Annuler
              </button>

              <button
                type="button"
                className="button danger users-action-button"
                onClick={handleDelete}
                disabled={deleteLoading}
              >
                {deleteLoading
                  ? "Suppression..."
                  : "Supprimer"}
              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}

export default Users;