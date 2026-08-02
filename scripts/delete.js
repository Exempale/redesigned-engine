// delete.js - Generic post deletion that works anywhere

function deletePost(postId, postElement, onSuccess) {
  fetch('/api/posts/' + postId, {
    method: 'DELETE'
  })
  .then(response => {
    if (response.ok) {
      // Option 1: Just remove the element (optimistic UI)
      postElement.remove()
      
      // Option 2: Also call success callback if provided
      if (onSuccess) {
        onSuccess()
      }
    } else {
      alert('Failed to delete post')
    }
  })
  .catch(err => {
    console.error('Delete error:', err)
    alert('Error deleting post')
  })
}