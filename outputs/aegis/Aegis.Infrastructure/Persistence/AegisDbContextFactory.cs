using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using System.Reflection;

namespace Aegis.Infrastructure.Persistence
{
    public class AegisDbContextFactory
    : IDesignTimeDbContextFactory<AegisDbContext>
    {
        public AegisDbContext CreateDbContext(string[] args)
        {
            var basePath = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);

            var config = new ConfigurationBuilder()
                .SetBasePath(basePath!)
                .AddJsonFile("appsettings.json", optional: true)
                .Build();

            var optionsBuilder = new DbContextOptionsBuilder<AegisDbContext>();

            optionsBuilder.UseSqlServer(
                config.GetConnectionString("DefaultConnection"));

            return new AegisDbContext(
                optionsBuilder.Options,
                new DesignTimeCurrentUserService());
        }
    }
}
