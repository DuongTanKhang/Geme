using Aegis.Domain.Common;

namespace Aegis.Domain.Entities
{
    public class Role : BaseEntity
    {
        public string? Name { get; private set; }
        public string? Description { get; private set; }

        private Role() { }

        public Role(string name, string? description = null)
        {
            Name = name;
            Description = description;
        }

        public void Update(string name, string? description)
        {
            SetName(name);
            Description = description;
        }

        private void SetName(string name)
        {
            if (string.IsNullOrWhiteSpace(name))
                throw new ArgumentException("Role name cannot be empty");

            Name = name;
        }


    }
}
